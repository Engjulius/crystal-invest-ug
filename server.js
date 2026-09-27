const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const cron = require('node-cron');
const mongoose = require('mongoose');
const { User, Package, UserPackage, Transaction, Deposit, Withdrawal } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== REAL-TIME SESSION TRACKER ====================
const activeUsers = new Map();
const ACTIVE_TIMEOUT = 3 * 60 * 1000; // 3 minutes inactivity timeout

function trackActivity(userId) {
    if (userId) {
        activeUsers.set(String(userId), Date.now());
    }
}

setInterval(() => {
    const now = Date.now();
    for (let [userId, timestamp] of activeUsers.entries()) {
        if (now - timestamp > ACTIVE_TIMEOUT) {
            activeUsers.delete(userId);
        }
    }
}, 60 * 1000);

// ==================== PUBLIC API ROUTES ====================

app.get('/api/packages', async (req, res) => {
    try {
        const packages = await Package.find({});
        res.json(packages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, phone, password, first_name, second_name, district, dob, gmail, sex, network, referral_code } = req.body;

        if (!username || !phone || !password || !first_name || !second_name || !district || !dob || !sex || !network) {
            return res.status(400).json({ error: 'Please fill in all required fields.' });
        }

        let validReferrer = null;
        if (referral_code && referral_code.trim() !== '') {
            const referrerUser = await User.findOne({ username: referral_code.trim() });
            if (referrerUser) validReferrer = referrerUser.username;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            username,
            phone,
            password: hashedPassword,
            first_name,
            second_name,
            district,
            dob,
            gmail: gmail || '',
            sex,
            network,
            referred_by: validReferrer
        });

        await newUser.save();
        res.json({ success: true, message: 'Account created successfully!', userId: newUser._id });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Username or Phone number already registered.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) return res.status(400).json({ error: 'Please enter phone and password.' });

        const user = await User.findOne({ phone });
        if (!user) return res.status(400).json({ error: 'Invalid phone number or password.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid phone number or password.' });
        
        trackActivity(user._id);
        res.json({ success: true, message: 'Login successful', userId: user._id, username: user.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Secure Password Reset using Last Transaction ID (tx_ref) Verification
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { phone, tx_ref, new_password } = req.body;

        const phoneStr = phone ? phone.trim() : '';
        const txRefStr = tx_ref ? tx_ref.trim() : '';

        if (!phoneStr || !txRefStr || !new_password) {
            return res.status(400).json({ error: 'Please provide your phone number, transaction ID, and new password.' });
        }

        const user = await User.findOne({ phone: phoneStr });
        if (!user) {
            return res.status(404).json({ error: 'No account found with this phone number.' });
        }

        // Verify that this specific user actually made a deposit with this exact tx_ref
        const validDeposit = await Deposit.findOne({
            user_id: user._id,
            tx_ref: txRefStr
        });

        if (!validDeposit) {
            return res.status(400).json({ error: 'Invalid transaction reference ID. Password reset denied.' });
        }

        // Hash the new password and save
        user.password = await bcrypt.hash(new_password, 10);
        await user.save();

        // Audit log for security
        await Transaction.create({
            user_id: user._id,
            type: 'PASSWORD_RESET',
            amount: 0,
            description: 'Password reset successfully via transaction verification'
        });

        res.json({ success: true, message: 'Password reset successful! You can now log in.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== USER DASHBOARD & ACTION APIS ====================

app.get('/api/user/:id', async (req, res) => {
    try {
        trackActivity(req.params.id);
        const user = await User.findById(req.params.id).select('username phone first_name second_name balance withdrawable_profit referred_by');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user-packages/:id', async (req, res) => {
    try {
        trackActivity(req.params.id);
        const userPackages = await UserPackage.find({ user_id: req.params.id });
        res.json(userPackages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/transactions/:id', async (req, res) => {
    try {
        trackActivity(req.params.id);
        const transactions = await Transaction.find({ user_id: req.params.id }).sort({ timestamp: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/deposit', async (req, res) => {
    try {
        const { user_id, amount, tx_ref } = req.body;
        trackActivity(user_id);
        if (!amount || amount <= 0 || !tx_ref) {
            return res.status(400).json({ error: 'Please provide valid amount and mobile money transaction reference ID.' });
        }

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        await Deposit.create({
            user_id,
            username: user.username,
            phone: user.phone,
            amount,
            tx_ref
        });

        res.json({ success: true, message: 'Deposit request submitted successfully! Awaiting admin confirmation.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Buy Mining Package (Robust Lookup supporting ObjectId, custom ID, and Name)
app.post('/api/buy-package', async (req, res) => {
    try {
        const { user_id, package_id } = req.body;
        trackActivity(user_id);

        let pkg = null;
        if (package_id) {
            if (mongoose.Types.ObjectId.isValid(package_id)) {
                pkg = await Package.findById(package_id);
            }
            if (!pkg) {
                pkg = await Package.findOne({ id: package_id });
            }
            if (!pkg) {
                pkg = await Package.findOne({ name: package_id });
            }
        }

        if (!pkg) return res.status(404).json({ error: 'Package not found.' });

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (user.balance < pkg.capital) return res.status(400).json({ error: 'Insufficient main balance. Please top up.' });

        const totalActiveCount = await UserPackage.countDocuments({ user_id, status: 'Ongoing' });
        if (totalActiveCount >= 10) {
            return res.status(400).json({ error: 'Max limit reached: You can only have a maximum of 10 active mining rigs/ledges total.' });
        }

        const activeTierCount = await UserPackage.countDocuments({ user_id, package_name: pkg.name, status: 'Ongoing' });
        if (activeTierCount >= 3) {
            return res.status(400).json({ error: 'Max limit reached: Only 3 active instances allowed per package tier.' });
        }

        user.balance -= pkg.capital;
        await user.save();

        const endDate = new Date(Date.now() + pkg.duration_days * 24 * 60 * 60 * 1000);
        await UserPackage.create({
            user_id,
            package_name: pkg.name,
            capital: pkg.capital,
            daily_yield_percent: pkg.daily_yield_percent,
            duration_days: pkg.duration_days,
            end_date: endDate
        });

        await Transaction.create({
            user_id,
            type: 'PACKAGE_PURCHASE',
            amount: pkg.capital,
            description: `Purchased ${pkg.name}`
        });

        res.json({ success: true, message: `Successfully deployed ${pkg.name}!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { user_id, amount, type } = req.body;
        trackActivity(user_id);

        const now = new Date();
        const hours = now.getHours();
        if (hours < 8 || hours >= 20) {
            return res.status(400).json({ error: 'Withdrawals are closed. Operating hours are strictly 8:00 AM to 8:00 PM.' });
        }

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        if (type === 'PROFIT') {
            if (user.withdrawable_profit < amount) return res.status(400).json({ error: 'Insufficient withdrawable profit balance.' });

            user.withdrawable_profit -= amount;
            await user.save();

            await Withdrawal.create({
                user_id,
                username: user.username,
                phone: user.phone,
                amount
            });

            await Transaction.create({
                user_id,
                type: 'WITHDRAWAL',
                amount,
                description: 'Withdrawable profit cashout'
            });

            res.json({ success: true, message: 'Withdrawal request submitted successfully!' });
        } else {
            return res.status(400).json({ error: 'Invalid withdrawal category.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ADMIN API ROUTES ====================

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'adminj' && password === '8080') {
        res.json({ success: true, token: 'admin_session_token' });
    } else {
        res.status(401).json({ error: 'Invalid admin credentials.' });
    }
});

app.get('/api/admin/deposits', async (req, res) => {
    try {
        const deposits = await Deposit.find({}).sort({ requested_at: -1 });
        res.json(deposits);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/deposit-action', async (req, res) => {
    try {
        const { deposit_id, status } = req.body;

        const dep = await Deposit.findById(deposit_id);
        if (!dep) return res.status(404).json({ error: 'Deposit request not found.' });
        if (dep.status !== 'Pending') return res.status(400).json({ error: 'Deposit request already processed.' });

        dep.status = status;
        await dep.save();

        if (status === 'Approved') {
            const user = await User.findById(dep.user_id);
            if (user) {
                user.balance += dep.amount;
                await user.save();

                await Transaction.create({
                    user_id: dep.user_id,
                    type: 'DEPOSIT_CREDIT',
                    amount: dep.amount,
                    description: `Approved Deposit Ref: ${dep.tx_ref}`
                });

                const depositCreditCount = await Transaction.countDocuments({ user_id: dep.user_id, type: 'DEPOSIT_CREDIT' });

                if (depositCreditCount === 1 && user.referred_by && user.referred_by.trim() !== '') {
                    const bonusAmount = dep.amount * 0.10;

                    const referrer = await User.findOne({ username: user.referred_by });
                    if (referrer) {
                        referrer.withdrawable_profit += bonusAmount;
                        referrer.balance += bonusAmount;
                        await referrer.save();

                        await Transaction.create({
                            user_id: referrer._id,
                            type: 'Referral Bonus',
                            amount: bonusAmount,
                            description: `10% commission from @${user.username}'s first deposit`
                        });
                    }
                }
            }
        }

        res.json({ success: true, message: `Deposit marked as ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find({}).sort({ requested_at: -1 });
        res.json(withdrawals);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/withdrawal-action', async (req, res) => {
    try {
        const { withdrawal_id, status } = req.body;

        const withdrawal = await Withdrawal.findById(withdrawal_id);
        if (!withdrawal) return res.status(404).json({ error: 'Withdrawal request not found.' });

        const previousStatus = withdrawal.status;
        withdrawal.status = status;
        await withdrawal.save();

        // If marked as Rejected, refund directly back to withdrawable profit
        if (status === 'Rejected' && previousStatus !== 'Rejected') {
            const user = await User.findById(withdrawal.user_id);
            if (user) {
                user.withdrawable_profit += withdrawal.amount;
                await user.save();

                await Transaction.create({
                    user_id: withdrawal.user_id,
                    type: 'WITHDRAWAL_REFUND',
                    amount: withdrawal.amount,
                    description: `Refund for rejected withdrawal request`
                });
            }
        }

        res.json({ success: true, message: `Withdrawal marked as ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const userAgg = await User.aggregate([
            {
                $group: {
                    _id: null,
                    total_balances: { $sum: '$balance' },
                    total_profits: { $sum: '$withdrawable_profit' },
                    total_users: { $sum: 1 },
                    total_males: { $sum: {$cond: [{ $eq: ['$sex', 'Male'] }, 1, 0] } },
                    total_females: { $sum: {$cond: [{ $eq: ['$sex', 'Female'] }, 1, 0] } }
                }
            }
        ]);

        const mineAgg = await UserPackage.aggregate([
            { $match: { status: 'Ongoing' } },
            {
                $group: {
                    _id: null,
                    active_mines: { $sum: 1 },
                    active_capital: { $sum: '$capital' }
                }
            }
        ]);

        const userStats = userAgg[0] || { total_balances: 0, total_profits: 0, total_users: 0, total_males: 0, total_females: 0 };
        const mineStats = mineAgg[0] || { active_mines: 0, active_capital: 0 };

        res.json({
            ...userStats,
            ...mineStats,
            online_users: activeUsers.size
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/user-packages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const total = await UserPackage.countDocuments({});
        const rawPackages = await UserPackage.find({})
            .sort({ start_date: -1 })
            .skip(offset)
            .limit(limit);

        // Manually attach user info to ensure username and phone are never undefined
        const packages = await Promise.all(rawPackages.map(async (pkg) => {
            const user = await User.findById(pkg.user_id).select('username phone');
            return {
                ...pkg.toObject(),
                username: user ? user.username : 'Unknown',
                phone: user ? user.phone : 'N/A'
            };
        }));

        res.json({
            packages,
            total,
            hasMore: offset + packages.length < total
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== AUTOMATED CRON: 24-HOUR ROLLING HARVEST ====================
cron.schedule('0 * * * *', () => {
    processAutomaticProfits();
});

setInterval(() => {
    processAutomaticProfits();
}, 60 * 60 * 1000); 

async function processAutomaticProfits() {
    try {
        const now = new Date();
        const activePackages = await UserPackage.find({
            status: 'Ongoing',
            $expr: {$lt: ['$days_harvested', '$duration_days'] }
        });

        for (let pkg of activePackages) {
            const lastHarvest = new Date(pkg.last_harvest_date);
            const hoursPassed = (now - lastHarvest) / (1000 * 60 * 60);

            if (hoursPassed >= 24) {
                const dailyProfit = pkg.capital * (pkg.daily_yield_percent / 100);
                const newDaysHarvested = pkg.days_harvested + 1;
                const newStatus = newDaysHarvested >= pkg.duration_days ? 'Completed' : 'Ongoing';

                const user = await User.findById(pkg.user_id);
                if (user) {
                    user.withdrawable_profit += dailyProfit;
                    user.balance += dailyProfit;
                    await user.save();
                }

                pkg.days_harvested = newDaysHarvested;
                pkg.last_harvest_date = now;
                pkg.status = newStatus;
                await pkg.save();

                await Transaction.create({
                    user_id: pkg.user_id,
                    type: 'Automatic Yield',
                    amount: dailyProfit,
                    description: `Automatic daily yield (${pkg.daily_yield_percent}%) for ${pkg.package_name}`
                });
            }
        }
    } catch (err) {
        console.error('Error in processAutomaticProfits:', err.message);
    }
}

app.get('/api/user-referrals/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const referrals = await User.find({ referred_by: user.username }).select('username created_at');
        
        const txResult = await Transaction.aggregate([
            { $match: { user_id: user._id, type: 'Referral Bonus' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalEarnings = txResult[0] ? txResult[0].total : 0;

        res.json({
            username: user.username,
            total_referrals: referrals.length,
            total_earnings: totalEarnings,
            referrals
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Crystal Invest Uganda Server running on port ${PORT}`);
});