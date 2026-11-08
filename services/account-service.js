const crypto = require('node:crypto');

function createAccountService(dependencies) {
  const {
    User, Account, Counter, Transaction, Session, LoginAttempt, Activation,
    StockPortfolio, StockTrade,
    Beneficiary, ScheduledTransfer, PaymentRequest, VirtualCard,
    SavingsGoal, Dispute, AuditLog, Notification,
    mongoose, io, SYSTEM_ACTOR_USER_ID,
    MAX_ACCOUNTS_PER_USER
  } = dependencies;

  // This helper creates a new five-digit user ID by incrementing the shared counter.
  // The sequence is stored in MongoDB so the ID is unique even if the server restarts.
  async function nextUserId() {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'users' },
      { $inc: { sequence: 1 } },
      { new: true }
    );
  
    // Once the sequence reaches 100000, no more valid IDs are available in the five-digit range.
    if (!counter || counter.sequence > 99999) {
      const error = new Error('All five-digit user IDs have been used.');
      error.code = 'USER_IDS_EXHAUSTED';
      throw error;
    }
  
    return counter.sequence;
  }
  
  // Use a database-backed sequence so account numbers remain unique across server restarts.
  async function nextAccountNumber() {
    const counter = await Counter.findOneAndUpdate(
      { _id: 'accounts' },
      { $inc: { sequence: 1 } },
      { new: true }
    );
  
    if (!counter || counter.sequence > 9999999999) {
      const error = new Error('All account numbers have been used.');
      error.code = 'ACCOUNT_NUMBERS_EXHAUSTED';
      throw error;
    }
  
    return String(counter.sequence);
  }
  
  // When the app starts, it must ensure that the database has every required index and counter value.
  // This prevents duplicate user IDs and keeps legacy records compatible with the public API format.
  async function initializeUserIds() {
    await User.init(); // Create the unique indexes before assigning public IDs.
    await Account.init();
    await Transaction.init();
    await Session.init();
    await LoginAttempt.init();
    await Activation.init();
    await StockPortfolio?.init();
    await StockTrade?.init();
    await Beneficiary?.init();
    await ScheduledTransfer?.init();
    await PaymentRequest?.init();
    await VirtualCard?.init();
    await SavingsGoal?.init();
    await Dispute?.init();
    await AuditLog?.init();
    await Notification?.init();
    await User.updateMany({ role: { $exists: false } }, { $set: { role: 'customer' } });
    await User.updateMany({ status: { $exists: false } }, { $set: { status: 'active' } });
  
    const highestAssignedUser = await User.findOne({ userId: { $exists: true } })
      .sort({ userId: -1 })
      .select('userId')
      .lean();
    const startingSequence = Math.max(9999, highestAssignedUser?.userId || 9999);
  
    // Keep the counter at least as high as the IDs already stored in MongoDB.
    await Counter.updateOne(
      { _id: 'users' },
      { $max: { sequence: startingSequence } },
      { upsert: true }
    );
  
    // Keep the account sequence above all account numbers already present in the database.
    const [highestUserAccount, highestProductAccount] = await Promise.all([
      User.findOne({ accountNumber: { $exists: true } })
        .sort({ accountNumber: -1 })
        .select('accountNumber')
        .lean(),
      Account.findOne({ accountNumber: { $exists: true } })
        .sort({ accountNumber: -1 })
        .select('accountNumber')
        .lean()
    ]);
    await Counter.updateOne(
      { _id: 'accounts' },
      { $max: { sequence: Math.max(
        Number(highestUserAccount?.accountNumber) || 999999999,
        Number(highestProductAccount?.accountNumber) || 999999999
      ) } },
      { upsert: true }
    );
  
    // Existing customers receive an account with a zero balance during migration.
    // Administrators do not hold personal bank accounts.
    const usersMissingFields = await User.find({
      $or: [
        { userId: { $exists: false } },
        { role: { $ne: 'admin' }, accountNumber: { $exists: false } },
        { balanceMinor: { $exists: false } }
      ]
    }).select('_id role userId accountNumber balanceMinor').lean();
  
    for (const user of usersMissingFields) {
      const updates = {};
      if (!user.userId) updates.userId = await nextUserId();
      if (user.role !== 'admin' && !user.accountNumber) updates.accountNumber = await nextAccountNumber();
      if (!Number.isSafeInteger(user.balanceMinor)) updates.balanceMinor = 0;
      if (Object.keys(updates).length > 0) {
        await User.updateOne(
          { _id: user._id },
          { $set: updates }
        );
      }
    }
  
    const existingCustomers = await User.find({
      role: { $ne: 'admin' },
      accountNumber: { $exists: true }
    })
      .select('_id accountNumber balanceMinor status')
      .lean();
    const currentMonth = new Date().toISOString().slice(0, 7);
    for (const customer of existingCustomers) {
      await Account.updateOne(
        { accountNumber: customer.accountNumber },
        {
          $setOnInsert: {
            ownerUserId: customer._id,
            accountNumber: customer.accountNumber,
            accountType: 'cheque',
            status: customer.status === 'pending' || customer.status === 'closed'
              ? customer.status
              : 'active',
            balanceMinor: customer.balanceMinor,
            lastInterestCreditedMonth: currentMonth
          }
        },
        { upsert: true }
      );
    }
  
    const accountCounts = await Account.aggregate([
      { $match: { status: { $in: ['active', 'pending', 'frozen'] } } },
      { $group: { _id: '$ownerUserId', count: { $sum: 1 } } }
    ]);
    const accountCountByOwner = new Map(
      accountCounts.map(({ _id, count }) => [String(_id), count])
    );
    const users = await User.find().select('_id role accountCount status').lean();
    for (const user of users) {
      const accountCount = user.status === 'closed' || user.role === 'admin'
        ? 0
        : accountCountByOwner.get(String(user._id)) || 0;
      if (user.accountCount !== accountCount) {
        await User.updateOne({ _id: user._id }, { $set: { accountCount } });
      }
    }
  }
  
  function accountLimitReached(accountCount) {
    return accountCount >= MAX_ACCOUNTS_PER_USER;
  }
  
  function currentMonthKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
  }
  
  function previousMonthKey(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  }
  
  function nextMonthKey(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  
  function monthlySavingsInterestMinor(balanceMinor) {
    return Math.round(balanceMinor / 100);
  }
  
  async function ownedAccountNumbers(user) {
    if (user.role === 'admin') return null;
    const accounts = await Account.find({ ownerUserId: user._id, status: { $in: ['active', 'frozen'] } })
      .select('accountNumber')
      .lean();
    return accounts.map((account) => account.accountNumber);
  }
  
  async function creditMonthlySavingsInterest(now = new Date()) {
    if (process.env.NODE_ENV === 'production') return;
    const lastCompletedMonth = previousMonthKey(currentMonthKey(now));
    const savingsAccounts = await Account.find({
      accountType: 'savings',
      status: 'active',
      lastInterestCreditedMonth: { $lt: lastCompletedMonth }
    }).select('_id ownerUserId accountNumber').lean();
  
    for (const savingsAccount of savingsAccounts) {
      let account = await Account.findById(savingsAccount._id)
        .select('ownerUserId accountNumber balanceMinor lastInterestCreditedMonth')
        .lean();
      while (account?.lastInterestCreditedMonth &&
          account.lastInterestCreditedMonth < lastCompletedMonth) {
        const month = nextMonthKey(account.lastInterestCreditedMonth);
        const interestMinor = monthlySavingsInterestMinor(account.balanceMinor);
        if (account.balanceMinor > Number.MAX_SAFE_INTEGER - interestMinor) {
          throw new Error(`Savings account ${account.accountNumber} cannot safely receive its monthly interest.`);
        }
        let session;
        let credited = false;
        try {
          session = await mongoose.startSession();
          await session.withTransaction(async () => {
            credited = false;
            const updatedAccount = await Account.findOneAndUpdate(
              {
                _id: account._id,
                lastInterestCreditedMonth: account.lastInterestCreditedMonth,
                balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - interestMinor }
              },
              {
                $inc: { balanceMinor: interestMinor },
                $set: { lastInterestCreditedMonth: month }
              },
              { new: true, session }
            );
            if (!updatedAccount) return;
            credited = interestMinor > 0;
  
            if (credited) {
              const idempotencyKey = `interest:${account.accountNumber}:${month}`;
              const requestFingerprint = crypto.createHash('sha256')
                .update(JSON.stringify({ type: 'interest', accountNumber: account.accountNumber, month, interestMinor }))
                .digest('hex');
              await Transaction.create([{
                type: 'interest',
                actorUserId: SYSTEM_ACTOR_USER_ID,
                idempotencyKey,
                requestFingerprint,
                fromAccount: 'INTEREST',
                toAccount: account.accountNumber,
                amountMinor: interestMinor,
                description: `Savings interest for ${month}`
              }], { session });
            }
  
            const primaryAccount = await User.findOne({
              _id: account.ownerUserId,
              accountNumber: account.accountNumber
            }).session(session);
            if (primaryAccount) {
              await User.updateOne(
                { _id: primaryAccount._id },
                { $inc: { balanceMinor: interestMinor } },
                { session }
              );
            }
          });
          if (credited) {
            await Notification?.create({
              userId: account.ownerUserId,
              type: 'interest',
              message: `Savings interest of R ${(interestMinor / 100).toFixed(2)} for ${month} credited to ${account.accountNumber}.`
            }).catch(() => {});
            io.to(`user:${account.ownerUserId}`).emit('interest:credited', {
              message: `Savings interest for ${month} has been credited.`,
              accountNumber: account.accountNumber
            });
          }
        } finally {
          if (session) await session.endSession();
        }
  
        account = await Account.findById(savingsAccount._id)
          .select('ownerUserId accountNumber balanceMinor lastInterestCreditedMonth')
          .lean();
      }
    }
  }

  return {
    nextUserId,
    nextAccountNumber,
    initializeUserIds,
    accountLimitReached,
    currentMonthKey,
    previousMonthKey,
    nextMonthKey,
    monthlySavingsInterestMinor,
    ownedAccountNumbers,
    creditMonthlySavingsInterest
  };
}

module.exports = { createAccountService };
