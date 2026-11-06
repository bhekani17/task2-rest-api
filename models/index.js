const mongoose = require('mongoose');

const MAX_ACCOUNTS_PER_USER = 3;

// A Mongoose schema defines the structure of each user document in MongoDB.
// It also enforces validation rules such as required fields and numeric ID constraints.
// The timestamps option automatically adds createdAt and updatedAt to every document.
// The unique option prevents duplicate email addresses from being stored.
const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    min: 10000,
    max: 99999,
    validate: Number.isInteger,
    unique: true,
    sparse: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, select: false },
  passwordHash: { type: String, select: false },
  profilePhoto: { type: Buffer, select: false },
  profilePhotoContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], default: null },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer', required: true },
  status: { type: String, enum: ['pending', 'active', 'closed'], default: 'active', required: true },
  accountNumber: { type: String, unique: true, sparse: true },
  accountCount: { type: Number, required: true, default: 1, min: 0, max: MAX_ACCOUNTS_PER_USER, validate: Number.isInteger },
  balanceMinor: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger }
}, {
  timestamps: true,
  toJSON: {
    transform: (document, result) => {
      result.id = result.userId;
      delete result.userId;
      delete result.password;
      delete result.passwordHash;
      delete result._id;
      delete result.__v;
      return result;
    }
  }
});

// The User model is the MongoDB collection interface we use in all route handlers.
// It exposes methods such as find(), findOne(), create(), updateOne(), and deleteOne().
const User = mongoose.model('User', userSchema);

const accountSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  accountNumber: { type: String, required: true, unique: true },
  accountType: { type: String, enum: ['cheque', 'savings'], required: true },
  status: { type: String, enum: ['pending', 'active', 'closed'], default: 'active', required: true },
  balanceMinor: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  lastInterestCreditedMonth: { type: String, default: null }
}, { timestamps: true });
accountSchema.index({ accountType: 1, status: 1, lastInterestCreditedMonth: 1 });
const Account = mongoose.model('Account', accountSchema);

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Session = mongoose.model('Session', sessionSchema);

const loginAttemptSchema = new mongoose.Schema({
  _id: String,
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true }
});
loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const LoginAttempt = mongoose.model('LoginAttempt', loginAttemptSchema);

const activationSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
activationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Activation = mongoose.model('Activation', activationSchema);

// Store every money movement as a ledger entry; balances are stored as integer cents.
const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['deposit', 'withdrawal', 'transfer', 'interest', 'stock_buy', 'stock_sell'], required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  idempotencyKey: { type: String, required: true },
  requestFingerprint: { type: String, required: true },
  fromAccount: { type: String, default: null, index: true },
  toAccount: { type: String, default: null, index: true },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  description: { type: String, trim: true, maxlength: 120, default: '' }
}, { timestamps: true });

transactionSchema.index({ createdAt: -1 });
transactionSchema.index(
  { actorUserId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { actorUserId: { $exists: true }, idempotencyKey: { $exists: true } } }
);
const Transaction = mongoose.model('Transaction', transactionSchema);

// This counter table keeps track of the next available user ID.
// Using a separate counter avoids collisions when multiple users are created quickly.
const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, required: true }
});
const Counter = mongoose.model('Counter', counterSchema);

const stockPortfolioSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  portfolioType: { type: String, enum: ['bank-funded'], required: true, default: 'bank-funded' },
  // Retained only to detect and remove virtual-cash portfolios created by the old simulator.
  virtualCashMinor: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
  holdings: [{
    _id: false,
    ticker: { type: String, required: true },
    shares: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    averageCostMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }
  }]
}, { timestamps: true });
const StockPortfolio = mongoose.model('StockPortfolio', stockPortfolioSchema);

const stockTradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  accountNumber: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  requestFingerprint: { type: String, required: true },
  ticker: { type: String, required: true },
  side: { type: String, enum: ['buy', 'sell'], required: true },
  shares: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  priceMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  totalMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }
}, { timestamps: true });
stockTradeSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
stockTradeSchema.index({ userId: 1, createdAt: -1 });
const StockTrade = mongoose.model('StockTrade', stockTradeSchema);

module.exports = {
  MAX_ACCOUNTS_PER_USER,
  User,
  Account,
  Session,
  LoginAttempt,
  Activation,
  Transaction,
  Counter,
  StockPortfolio,
  StockTrade
};
