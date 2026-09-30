const mongoose = require('mongoose');

// Connect to MongoDB Atlas (Replace with your actual connection string)
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://<username>:<password>@cluster.mongodb.net/crystal_invest?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('Connected to MongoDB Atlas successfully.');
        seedPackages();
    })
    .catch(err => console.error('MongoDB connection error:', err));

// --- SCHEMAS & MODELS ---

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    phone: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    first_name: { type: String, required: true },
    second_name: { type: String, required: true },
    district: { type: String, required: true },
    dob: { type: String, required: true },
    gmail: { type: String },
    sex: { type: String, required: true },
    network: { type: String, required: true },
    balance: { type: Number, default: 0 },
    withdrawable_profit: { type: Number, default: 0 },
    referred_by: { type: String },
    created_at: { type: Date, default: Date.now }
});

const packageSchema = new mongoose.Schema({
    name: { type: String, unique: true, required: true },
    capital: { type: Number, required: true },
    daily_yield_percent: { type: Number, required: true, default: 10.0 },
    duration_days: { type: Number, required: true, default: 30 }
});

const userPackageSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    package_name: { type: String, required: true },
    capital: { type: Number, required: true },
    daily_yield_percent: { type: Number, required: true },
    status: { type: String, default: 'Ongoing' },
    start_date: { type: Date, default: Date.now },
    last_harvest_date: { type: Date, default: Date.now },
    days_harvested: { type: Number, default: 0 },
    duration_days: { type: Number, required: true },
    end_date: { type: Date, required: true }
});

const transactionSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    description: { type: String },
    timestamp: { type: Date, default: Date.now }
});

const depositSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    tx_ref: { type: String, required: true },
    status: { type: String, default: 'Pending' },
    requested_at: { type: Date, default: Date.now }
});

const withdrawalSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    requested_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Package = mongoose.model('Package', packageSchema);
const UserPackage = mongoose.model('UserPackage', userPackageSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// Auto-seed packages with 10% daily yield
async function seedPackages() {
    const defaultPackages = [
        { name: 'Micro Crystal Node', capital: 10000, daily_yield_percent: 10.0, duration_days: 17 },
        { name: 'Quartz Crystal Node', capital: 25000, daily_yield_percent: 10.0, duration_days: 19 },
        { name: 'Ruby Extraction Unit', capital: 50000, daily_yield_percent: 10.0, duration_days: 21 },
        { name: 'Topaz Mining Rig', capital: 100000, daily_yield_percent: 10.0, duration_days: 23 },
        { name: 'Amethyst Crystal Vein', capital: 250000, daily_yield_percent: 10.0, duration_days: 25 },
        { name: 'Diamond Syndicate', capital: 500000, daily_yield_percent: 10.0, duration_days: 28 },
        { name: 'Sapphire Master Mine', capital: 1000000, daily_yield_percent: 10.0, duration_days: 30 },
        { name: 'Emerald Deep Shaft', capital: 2000000, daily_yield_percent: 10.0, duration_days: 30 }
    ];

    for (let pkg of defaultPackages) {
        await Package.updateOne({ name: pkg.name }, pkg, { upsert: true });
    }
    console.log('Mining packages synchronized to 10% daily yield.');
}

module.exports = { User, Package, UserPackage, Transaction, Deposit, Withdrawal };