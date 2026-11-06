function registerAccountRoutes(app, dependencies) {
  const {
    requireAdmin, User, Account, publicUser, reportServerError,
    currentMonthKey, nextAccountNumber, MAX_ACCOUNTS_PER_USER, accountLimitReached
  } = dependencies;

  // GET /api/users returns the complete list of users in JSON format.
  // Only administrators may retrieve the customer directory.
  app.get('/api/users', requireAdmin, async (req, res) => {
    try {
      const users = await User.find();
      res.status(200).json(users.map(publicUser));
    } catch (error) {
      reportServerError(res, 'Customer listing', error);
    }
  });
  
  // GET /api/accounts returns the signed-in customer's account summary.
  app.get('/api/accounts', async (req, res) => {
    try {
      const filter = req.authUser.role === 'admin'
        ? { status: 'active' }
        : { ownerUserId: req.authUser._id, status: 'active' };
      const accounts = await Account.find(filter)
        .populate('ownerUserId', 'name email')
        .sort({ createdAt: -1 })
        .lean();
      const totalBalanceMinor = accounts.reduce((total, account) => total + account.balanceMinor, 0);
      const ownedAccountCount = await Account.countDocuments({
        ownerUserId: req.authUser._id,
        status: 'active'
      });
  
      res.status(200).json({
        currency: 'ZAR',
        accountCount: accounts.length,
        ownedAccountCount,
        accountLimit: MAX_ACCOUNTS_PER_USER,
        totalBalance: totalBalanceMinor / 100,
        accounts: accounts.map((account) => ({
          name: account.ownerUserId.name,
          email: account.ownerUserId.email,
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          balance: account.balanceMinor / 100,
          currency: 'ZAR'
        }))
      });
    } catch (error) {
      reportServerError(res, 'Account listing', error);
    }
  });
  
  app.post('/api/accounts', async (req, res) => {
    const { accountType } = req.body || {};
    if (!['cheque', 'savings'].includes(accountType)) {
      return res.status(400).json({ error: 'Choose a cheque/current or savings account.' });
    }
    if (accountType === 'savings' && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Demo savings accounts are disabled in production.' });
    }
  
    let quotaReserved = false;
    try {
      const user = await User.findOneAndUpdate(
        {
          _id: req.authUser._id,
          status: 'active',
          accountCount: { $lt: MAX_ACCOUNTS_PER_USER }
        },
        { $inc: { accountCount: 1 } },
        { new: true }
      ).select('accountCount');
      if (!user) {
        const currentUser = await User.findById(req.authUser._id).select('accountCount status').lean();
        if (currentUser && accountLimitReached(currentUser.accountCount)) {
          return res.status(409).json({
            error: `You can have a maximum of ${MAX_ACCOUNTS_PER_USER} accounts.`
          });
        }
        return res.status(403).json({ error: 'An active account is required to open another account.' });
      }
      quotaReserved = true;
      const accountNumber = await nextAccountNumber();
      const account = await Account.create({
        ownerUserId: req.authUser._id,
        accountNumber,
        accountType,
        status: 'active',
        balanceMinor: 0,
        lastInterestCreditedMonth: currentMonthKey()
      });
      res.status(201).json({
        message: `${accountType === 'savings' ? 'Savings' : 'Cheque/current'} account opened.`,
        account: {
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          balance: account.balanceMinor / 100,
          currency: 'ZAR'
        }
      });
      quotaReserved = false;
    } catch (error) {
      if (quotaReserved) {
        try {
          const releasedQuota = await User.updateOne(
            { _id: req.authUser._id, accountCount: { $gt: 0 } },
            { $inc: { accountCount: -1 } }
          );
          if (releasedQuota.modifiedCount !== 1) {
            throw new Error('The reserved account slot could not be released.');
          }
        } catch (rollbackError) {
          reportServerError(res, 'Account quota release', rollbackError);
          return;
        }
      }
      if (error.code === 'ACCOUNT_NUMBERS_EXHAUSTED') {
        return res.status(503).json({ error: error.message });
      }
      reportServerError(res, 'Account opening', error);
    }
  });
}

module.exports = { registerAccountRoutes };
