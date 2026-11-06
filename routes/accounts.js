function registerAccountRoutes(app, dependencies) {
  const {
    requireAdmin, User, Account, publicUser, reportServerError,
    currentMonthKey, nextAccountNumber, MAX_ACCOUNTS_PER_USER, accountLimitReached
  } = dependencies;

  // Query parameters opt into a paginated customer directory while preserving the original array response.
  app.get('/api/users', requireAdmin, async (req, res) => {
    try {
      const { search, status, page, limit } = req.query;
      const isPaginated = ['search', 'status', 'page', 'limit'].some((key) => req.query[key] !== undefined);
      if ([search, status, page, limit].some((value) => value !== undefined && typeof value !== 'string')) {
        return res.status(400).json({ error: 'Customer filters must be single values.' });
      }
      if (typeof search === 'string' && search.trim().length > 80) {
        return res.status(400).json({ error: 'Customer search must be 80 characters or fewer.' });
      }
      if (status !== undefined && !['all', 'pending', 'active', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'Customer status filter is invalid.' });
      }
      const pageNumber = page === undefined ? 1 : Number(page);
      const pageSize = limit === undefined ? 10 : Number(limit);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000 ||
          !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        return res.status(400).json({ error: 'Page must be between 1 and 10,000 and page size between 1 and 100.' });
      }

      const filter = {};
      if (isPaginated) filter.role = 'customer';
      if (status && status !== 'all') filter.status = status;
      if (search?.trim()) {
        const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchTerms = [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } }
        ];
        if (/^\d{1,5}$/.test(search.trim())) searchTerms.push({ userId: Number(search.trim()) });
        filter.$or = searchTerms;
      }

      const usersQuery = User.find(filter).sort({ userId: 1 });
      if (isPaginated) usersQuery.skip((pageNumber - 1) * pageSize).limit(pageSize);
      const [users, total] = await Promise.all([
        usersQuery.lean(),
        isPaginated ? User.countDocuments(filter) : null
      ]);
      if (!isPaginated) return res.status(200).json(users.map(publicUser));
      res.status(200).json({
        users: users.map(publicUser),
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      });
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
