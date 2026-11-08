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
  status: { type: String, enum: ['pending', 'active', 'frozen', 'closed'], default: 'active', required: true },
  balanceMinor: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  lastInterestCreditedMonth: { type: String, default: null }
}, { timestamps: true });
accountSchema.index({ accountType: 1, status: 1, lastInterestCreditedMonth: 1 });
const Account = mongoose.model('Account', accountSchema);

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
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
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'transfer', 'interest', 'stock_buy', 'stock_sell', 'reversal', 'goal_allocate', 'goal_release'],
    required: true
  },
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

const beneficiarySchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  nickname: { type: String, trim: true, maxlength: 60, default: '' },
  accountNumber: { type: String, required: true, trim: true },
  defaultReference: { type: String, trim: true, maxlength: 120, default: '' }
}, { timestamps: true });
beneficiarySchema.index({ ownerUserId: 1, accountNumber: 1 }, { unique: true });
const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);

const scheduledTransferSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fromAccount: { type: String, required: true },
  toAccount: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  description: { type: String, trim: true, maxlength: 120, default: '' },
  frequency: { type: String, enum: ['once', 'weekly', 'monthly'], required: true, default: 'monthly' },
  nextRunAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['active', 'completed', 'cancelled', 'failed'], default: 'active', required: true },
  lastError: { type: String, default: null },
  lastExecutedAt: { type: Date, default: null }
}, { timestamps: true });
scheduledTransferSchema.index({ status: 1, nextRunAt: 1 });
const ScheduledTransfer = mongoose.model('ScheduledTransfer', scheduledTransferSchema);

const paymentRequestSchema = new mongoose.Schema({
  requesterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requesterName: { type: String, default: '' },
  payerName: { type: String, default: '' },
  fromAccount: { type: String, required: true },
  toAccount: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  description: { type: String, trim: true, maxlength: 120, default: '' },
  status: { type: String, enum: ['pending', 'paid', 'declined', 'cancelled'], default: 'pending', required: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null }
}, { timestamps: true });
paymentRequestSchema.index({ payerUserId: 1, status: 1, createdAt: -1 });
paymentRequestSchema.index({ requesterUserId: 1, status: 1, createdAt: -1 });
const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

const virtualCardSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  accountNumber: { type: String, required: true },
  cardHolderName: { type: String, required: true, trim: true },
  last4: { type: String, required: true },
  maskedNumber: { type: String, required: true },
  expiryMonth: { type: String, required: true },
  expiryYear: { type: String, required: true },
  status: { type: String, enum: ['active', 'frozen', 'cancelled'], default: 'active', required: true },
  dailyLimitMinor: { type: Number, required: true, default: 2500000, min: 10000, validate: Number.isSafeInteger },
  onlinePaymentsEnabled: { type: Boolean, default: true, required: true }
}, { timestamps: true });
virtualCardSchema.index({ ownerUserId: 1, createdAt: -1 });
const VirtualCard = mongoose.model('VirtualCard', virtualCardSchema);

const savingsGoalSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  accountNumber: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  targetMinor: { type: Number, required: true, min: 100, validate: Number.isSafeInteger },
  currentMinor: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ['active', 'completed'], default: 'active', required: true }
}, { timestamps: true });
savingsGoalSchema.index({ ownerUserId: 1, createdAt: -1 });
const SavingsGoal = mongoose.model('SavingsGoal', savingsGoalSchema);

const disputeSchema = new mongoose.Schema({
  reporterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
  accountNumber: { type: String, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 300 },
  status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open', required: true },
  resolutionNote: { type: String, trim: true, maxlength: 300, default: '' },
  reversalTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null }
}, { timestamps: true });
disputeSchema.index({ status: 1, createdAt: -1 });
const Dispute = mongoose.model('Dispute', disputeSchema);

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, trim: true, maxlength: 80 },
  detail: { type: String, trim: true, maxlength: 240, default: '' },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, { timestamps: true });
auditLogSchema.index({ userId: 1, createdAt: -1 });
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, trim: true, default: 'info' },
  message: { type: String, required: true, trim: true, maxlength: 240 },
  read: { type: Boolean, default: false, required: true }
}, { timestamps: true });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
const Notification = mongoose.model('Notification', notificationSchema);

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
  StockTrade,
  Beneficiary,
  ScheduledTransfer,
  PaymentRequest,
  VirtualCard,
  SavingsGoal,
  Dispute,
  AuditLog,
  Notification
};
