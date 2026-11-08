function registerAdminRoutes(app, dependencies) {
  const {
    requireAdmin, User, Account, Session, Transaction, mongoose, publicUser, reportServerError
  } = dependencies;

  app.get('/api/admin/summary', requireAdmin, async (req, res) => {
    try {
      const [activeCustomers, pendingCustomers, closedCustomers, activeAccounts, accountBalances, transactions] =
        await Promise.all([
          User.countDocuments({ role: 'customer', status: 'active' }),
          User.countDocuments({ role: 'customer', status: 'pending' }),
          User.countDocuments({ role: 'customer', status: 'closed' }),
          Account.countDocuments({ status: 'active' }),
          Account.aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: null, balanceMinor: { $sum: '$balanceMinor' } } }
          ]),
          Transaction.countDocuments({})
        ]);
      res.status(200).json({
        customers: { active: activeCustomers, pending: pendingCustomers, closed: closedCustomers },
        activeAccounts,
        totalBalance: (accountBalances[0]?.balanceMinor || 0) / 100,
        transactions
      });
    } catch (error) {
      reportServerError(res, 'Admin summary', error);
    }
  });

  app.get('/api/admin/accounts', requireAdmin, async (req, res) => {
    try {
      const { search, status = 'all', page = '1', limit = '10' } = req.query;
      if ([search, status, page, limit].some((value) => value !== undefined && typeof value !== 'string')) {
        return res.status(400).json({ error: 'Account filters must be single values.' });
      }
      if (search && search.trim().length > 80) {
        return res.status(400).json({ error: 'Account search must be 80 characters or fewer.' });
      }
      if (!['all', 'active', 'frozen', 'pending', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'Account status filter is invalid.' });
      }
      const pageNumber = Number(page);
      const pageSize = Number(limit);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000 ||
          !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        return res.status(400).json({ error: 'Page must be between 1 and 10,000 and page size between 1 and 100.' });
      }

      const filter = status === 'all' ? {} : { status };
      if (search?.trim()) {
        const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const owners = await User.find({
          $or: [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { email: { $regex: escapedSearch, $options: 'i' } }
          ]
        }).select('_id').lean();
        const ownerIds = owners.map((owner) => owner._id);
        const accountSearch = [{ accountNumber: { $regex: `^${escapedSearch}` } }];
        if (ownerIds.length) accountSearch.push({ ownerUserId: { $in: ownerIds } });
        filter.$or = accountSearch;
      }

      const [accounts, total] = await Promise.all([
        Account.find(filter)
          .populate('ownerUserId', 'userId name email')
          .sort({ createdAt: -1 })
          .skip((pageNumber - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Account.countDocuments(filter)
      ]);
      res.status(200).json({
        accounts: accounts.map((account) => ({
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          status: account.status,
          balance: account.balanceMinor / 100,
          createdAt: account.createdAt,
          owner: account.ownerUserId
            ? { id: account.ownerUserId.userId, name: account.ownerUserId.name, email: account.ownerUserId.email }
            : null
        })),
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      });
    } catch (error) {
      reportServerError(res, 'Admin account listing', error);
    }
  });

  app.delete('/api/admin/accounts/:accountNumber', requireAdmin, async (req, res) => {
    const { accountNumber } = req.params;
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Account number must be exactly 10 digits.' });
    }

    let session;
    try {
      session = await mongoose.startSession();
      let closedAccount;
      await session.withTransaction(async () => {
        closedAccount = await Account.findOneAndUpdate(
          { accountNumber, status: { $in: ['active', 'frozen', 'pending'] }, balanceMinor: 0 },
          { $set: { status: 'closed' } },
          { new: true, session }
        );
        if (!closedAccount) {
          const existing = await Account.findOne({ accountNumber }).session(session);
          if (!existing) {
            const error = new Error('Account not found.');
            error.statusCode = 404;
            throw error;
          }
          const error = new Error(existing.status === 'closed'
            ? 'This account is already closed.'
            : 'An account must have a zero balance before it can be closed.');
          error.statusCode = 409;
          throw error;
        }

        const openAccounts = await Account.find({
          ownerUserId: closedAccount.ownerUserId,
          status: { $in: ['active', 'frozen', 'pending'] }
        }).select('accountNumber balanceMinor').sort({ createdAt: 1 }).session(session).lean();
        const owner = await User.findById(closedAccount.ownerUserId).select('accountNumber').session(session).lean();
        const userUpdates = { accountCount: openAccounts.length };
        if (owner?.accountNumber === accountNumber) {
          userUpdates.accountNumber = openAccounts[0]?.accountNumber || accountNumber;
          userUpdates.balanceMinor = openAccounts[0]?.balanceMinor || 0;
        }
        await User.updateOne(
          { _id: closedAccount.ownerUserId },
          { $set: userUpdates },
          { session }
        );
      });
      res.status(200).json({ message: 'Account closed.', accountNumber });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (error.code === 20 || /transaction numbers are only allowed/i.test(String(error?.message || ''))) {
        return res.status(503).json({ error: 'Account closure requires MongoDB running as a replica set.' });
      }
      reportServerError(res, 'Admin account closure', error);
    } finally {
      if (session) await session.endSession();
    }
  });

  app.get('/api/users/:id', requireAdmin, async (req, res) => {
    if (!/^\d{5}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'User ID must be exactly five digits.' });
    }
  
    try {
      const user = await User.findOne({ userId: Number(req.params.id) });
      if (!user) {
        // 404 means the requested ID does not match a saved user.
        return res.status(404).json({ error: 'User not found.' });
      }
      res.status(200).json(user);
    } catch (error) {
      reportServerError(res, 'Customer lookup', error);
    }
  });
  
  // PUT /api/users/:id updates the selected user with new name and email values.
  // runValidators ensures the schema rules are checked before the update is saved.
  app.put('/api/users/:id', requireAdmin, async (req, res) => {
    if (!/^\d{5}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'User ID must be exactly five digits.' });
    }
  
    try {
      const { name, email } = req.body || {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
          typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'A valid name and email address are required.' });
      }
      const updatedUser = await User.findOneAndUpdate(
        { userId: Number(req.params.id) },
        { $set: { name: name.trim(), email: email.trim().toLowerCase() } },
        { new: true, runValidators: true } // Return the updated user and check schema rules.
      );
  
      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found.' });
      }
  
      res.status(200).json(updatedUser);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }
      reportServerError(res, 'Customer update', error);
    }
  });
  
  // DELETE /api/users/:id removes a single user record from MongoDB.
  // The response returns a short confirmation message plus the deleted user data for debugging or UI use.
  app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    if (!/^\d{5}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'User ID must be exactly five digits.' });
    }
  
    try {
      const user = await User.findOne({ userId: Number(req.params.id) }).select('balanceMinor status');
      if (!user) return res.status(404).json({ error: 'User not found.' });
      if (user.status === 'closed') {
        return res.status(409).json({ error: 'This account is already closed.' });
      }
      const fundedAccount = await Account.exists({
        ownerUserId: user._id,
        status: { $in: ['active', 'frozen', 'pending'] },
        balanceMinor: { $gt: 0 }
      });
      if (user.balanceMinor !== 0 || fundedAccount) {
        return res.status(409).json({ error: 'All accounts must have a zero balance before the customer can be closed.' });
      }
  
      const account = await User.findOneAndUpdate(
        { userId: Number(req.params.id), status: { $in: ['active', 'pending'] }, balanceMinor: 0 },
        { $set: { status: 'closed' } },
        { new: true, runValidators: true }
      );
      if (!account) {
        const existing = await User.findOne({ userId: Number(req.params.id) }).select('balanceMinor status');
        if (existing?.status === 'closed') {
          return res.status(409).json({ error: 'This account is already closed.' });
        }
        if (existing) {
          return res.status(409).json({ error: 'An account must have a zero balance before it can be closed.' });
        }
        return res.status(404).json({ error: 'User not found.' });
      }
      await Account.updateMany(
        { ownerUserId: account._id, status: { $in: ['active', 'frozen', 'pending'] } },
        { $set: { status: 'closed' } }
      );
      await User.updateOne({ _id: account._id }, { $set: { accountCount: 0 } });
      await Session.deleteMany({ userId: account._id });
      res.status(200).json({ message: 'Account closed.', user: publicUser(account) });
    } catch (error) {
      reportServerError(res, 'Account closure', error);
    }
  });
}

module.exports = { registerAdminRoutes };
