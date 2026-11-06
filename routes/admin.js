function registerAdminRoutes(app, dependencies) {
  const {
    requireAdmin, User, Account, Session, publicUser, reportServerError
  } = dependencies;

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
        status: { $in: ['active', 'pending'] },
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
        { ownerUserId: account._id, status: { $in: ['active', 'pending'] } },
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
