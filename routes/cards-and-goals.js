const crypto = require('node:crypto');

function registerCardsAndGoalsRoutes(app, dependencies) {
  const {
    User,
    Account,
    Transaction,
    VirtualCard,
    SavingsGoal,
    mongoose,
    parseAmountMinor,
    reportServerError,
    requireCustomer,
    logAudit
  } = dependencies;

  // 4. Virtual Debit Cards
  app.get('/api/cards', requireCustomer, async (req, res) => {
    try {
      const cards = await VirtualCard.find({
        ownerUserId: req.authUser._id,
        status: { $ne: 'cancelled' }
      }).sort({ createdAt: -1 }).lean();

      res.status(200).json({
        cards: cards.map((card) => ({
          id: String(card._id),
          accountNumber: card.accountNumber,
          cardHolderName: card.cardHolderName,
          last4: card.last4,
          maskedNumber: card.maskedNumber,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          status: card.status,
          dailyLimit: card.dailyLimitMinor / 100,
          currency: 'ZAR',
          onlinePaymentsEnabled: card.onlinePaymentsEnabled,
          createdAt: card.createdAt
        }))
      });
    } catch (error) {
      reportServerError(res, 'Virtual card listing', error);
    }
  });

  app.post('/api/cards', requireCustomer, async (req, res) => {
    const { accountNumber, dailyLimit } = req.body || {};
    if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Select a valid 10-digit account number for the card.' });
    }
    const dailyLimitMinor = dailyLimit === undefined || dailyLimit === ''
      ? 2_500_000
      : parseAmountMinor(dailyLimit);
    if (dailyLimitMinor === null || dailyLimitMinor < 10_000 || dailyLimitMinor > 50_000_000) {
      return res.status(400).json({ error: 'Daily card limit must be between R 100.00 and R 500,000.00.' });
    }

    try {
      const [ownsAccount, activeCardCount] = await Promise.all([
        Account.exists({ accountNumber, ownerUserId: req.authUser._id, status: 'active' }),
        VirtualCard.countDocuments({ ownerUserId: req.authUser._id, status: { $in: ['active', 'frozen'] } })
      ]);
      if (!ownsAccount) {
        return res.status(403).json({ error: 'You can only issue a virtual card for your own active account.' });
      }
      if (activeCardCount >= 5) {
        return res.status(409).json({ error: 'You can have a maximum of 5 active or frozen virtual cards.' });
      }

      const last4 = String(crypto.randomInt(1000, 10000));
      const mid4 = String(crypto.randomInt(1000, 10000));
      const now = new Date();
      const expiryMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
      const expiryYear = String((now.getUTCFullYear() + 4) % 100).padStart(2, '0');

      const card = await VirtualCard.create({
        ownerUserId: req.authUser._id,
        accountNumber,
        cardHolderName: req.authUser.name.toUpperCase(),
        last4,
        maskedNumber: `4532 ${mid4.slice(0, 2)}•• •••• ${last4}`,
        expiryMonth,
        expiryYear,
        status: 'active',
        dailyLimitMinor,
        onlinePaymentsEnabled: true
      });

      await logAudit(req.authUser._id, 'virtual_card_issued', `Issued virtual card ending in ${last4} for ${accountNumber}.`, req);

      res.status(201).json({
        message: 'Virtual debit card issued.',
        card: {
          id: String(card._id),
          accountNumber: card.accountNumber,
          cardHolderName: card.cardHolderName,
          last4: card.last4,
          maskedNumber: card.maskedNumber,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          status: card.status,
          dailyLimit: card.dailyLimitMinor / 100,
          currency: 'ZAR',
          onlinePaymentsEnabled: card.onlinePaymentsEnabled,
          createdAt: card.createdAt
        }
      });
    } catch (error) {
      reportServerError(res, 'Virtual card creation', error);
    }
  });

  app.patch('/api/cards/:id', requireCustomer, async (req, res) => {
    const { id } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid card ID.' });
    }
    const { status, onlinePaymentsEnabled, dailyLimit } = req.body || {};
    const updates = {};
    if (status !== undefined) {
      if (!['active', 'frozen', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Card status must be active, frozen, or cancelled.' });
      }
      updates.status = status;
    }
    if (onlinePaymentsEnabled !== undefined) {
      if (typeof onlinePaymentsEnabled !== 'boolean') {
        return res.status(400).json({ error: 'onlinePaymentsEnabled must be a boolean.' });
      }
      updates.onlinePaymentsEnabled = onlinePaymentsEnabled;
    }
    if (dailyLimit !== undefined) {
      const dailyLimitMinor = parseAmountMinor(dailyLimit);
      if (dailyLimitMinor === null || dailyLimitMinor < 10_000 || dailyLimitMinor > 50_000_000) {
        return res.status(400).json({ error: 'Daily card limit must be between R 100.00 and R 500,000.00.' });
      }
      updates.dailyLimitMinor = dailyLimitMinor;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Provide card controls to update.' });
    }

    try {
      const card = await VirtualCard.findOneAndUpdate(
        { _id: id, ownerUserId: req.authUser._id, status: { $ne: 'cancelled' } },
        { $set: updates },
        { new: true }
      );
      if (!card) {
        return res.status(404).json({ error: 'Virtual card not found.' });
      }
      await logAudit(req.authUser._id, 'virtual_card_updated', `Updated controls for card ending in ${card.last4}.`, req);

      res.status(200).json({
        message: 'Card controls updated.',
        card: {
          id: String(card._id),
          accountNumber: card.accountNumber,
          cardHolderName: card.cardHolderName,
          last4: card.last4,
          maskedNumber: card.maskedNumber,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          status: card.status,
          dailyLimit: card.dailyLimitMinor / 100,
          currency: 'ZAR',
          onlinePaymentsEnabled: card.onlinePaymentsEnabled,
          createdAt: card.createdAt
        }
      });
    } catch (error) {
      reportServerError(res, 'Virtual card update', error);
    }
  });

  // 5. Savings Goals (Pockets / Vaults)
  app.get('/api/savings-goals', requireCustomer, async (req, res) => {
    try {
      const goals = await SavingsGoal.find({ ownerUserId: req.authUser._id })
        .sort({ createdAt: -1 })
        .lean();
      res.status(200).json({
        goals: goals.map((goal) => ({
          id: String(goal._id),
          accountNumber: goal.accountNumber,
          name: goal.name,
          targetAmount: goal.targetMinor / 100,
          currentAmount: goal.currentMinor / 100,
          progressPercent: Math.min(100, Math.round((goal.currentMinor / goal.targetMinor) * 100)),
          currency: 'ZAR',
          status: goal.status,
          createdAt: goal.createdAt
        }))
      });
    } catch (error) {
      reportServerError(res, 'Savings goal listing', error);
    }
  });

  app.post('/api/savings-goals', requireCustomer, async (req, res) => {
    const { accountNumber, name, targetAmount } = req.body || {};
    const targetMinor = parseAmountMinor(targetAmount);
    if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Select a valid 10-digit account for this savings goal.' });
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
      return res.status(400).json({ error: 'Enter a goal name of 1 to 60 characters.' });
    }
    if (targetMinor === null || targetMinor < 100) {
      return res.status(400).json({ error: 'Target amount must be at least R 1.00.' });
    }

    try {
      const ownsAccount = await Account.exists({
        accountNumber,
        ownerUserId: req.authUser._id,
        status: 'active'
      });
      if (!ownsAccount) {
        return res.status(403).json({ error: 'You can only create a savings goal on your own active account.' });
      }

      const goal = await SavingsGoal.create({
        ownerUserId: req.authUser._id,
        accountNumber,
        name: name.trim(),
        targetMinor,
        currentMinor: 0,
        status: 'active'
      });

      res.status(201).json({
        message: 'Savings goal created.',
        goal: {
          id: String(goal._id),
          accountNumber: goal.accountNumber,
          name: goal.name,
          targetAmount: goal.targetMinor / 100,
          currentAmount: 0,
          progressPercent: 0,
          currency: 'ZAR',
          status: goal.status,
          createdAt: goal.createdAt
        }
      });
    } catch (error) {
      reportServerError(res, 'Savings goal creation', error);
    }
  });

  app.post('/api/savings-goals/:id/allocate', requireCustomer, async (req, res) => {
    const { id } = req.params;
    const { direction = 'deposit', amount } = req.body || {};
    const amountMinor = parseAmountMinor(amount);
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid savings goal ID.' });
    }
    if (!['deposit', 'withdraw'].includes(direction)) {
      return res.status(400).json({ error: 'Direction must be deposit or withdraw.' });
    }
    if (amountMinor === null) {
      return res.status(400).json({ error: 'Enter a valid amount greater than zero.' });
    }

    let session;
    try {
      let updatedGoal;
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const goal = await SavingsGoal.findOne({ _id: id, ownerUserId: req.authUser._id }).session(session);
        if (!goal) {
          const err = new Error('Savings goal not found.');
          err.statusCode = 404;
          throw err;
        }

        if (direction === 'deposit') {
          const account = await Account.findOneAndUpdate(
            {
              accountNumber: goal.accountNumber,
              ownerUserId: req.authUser._id,
              status: 'active',
              balanceMinor: { $gte: amountMinor }
            },
            { $inc: { balanceMinor: -amountMinor } },
            { new: true, session }
          );
          if (!account) {
            const err = new Error('Insufficient available balance in linked account.');
            err.statusCode = 409;
            throw err;
          }
          await User.updateOne(
            { _id: req.authUser._id, accountNumber: goal.accountNumber },
            { $inc: { balanceMinor: -amountMinor } },
            { session }
          );

          const nextMinor = goal.currentMinor + amountMinor;
          const nextStatus = nextMinor >= goal.targetMinor ? 'completed' : 'active';
          updatedGoal = await SavingsGoal.findOneAndUpdate(
            { _id: goal._id },
            { $inc: { currentMinor: amountMinor }, $set: { status: nextStatus } },
            { new: true, session }
          );

          const key = `goal-alloc:${goal._id}:${crypto.randomUUID()}`;
          await Transaction.create([{
            type: 'goal_allocate',
            actorUserId: req.authUser._id,
            idempotencyKey: key,
            requestFingerprint: crypto.createHash('sha256').update(key).digest('hex'),
            fromAccount: goal.accountNumber,
            toAccount: `GOAL:${goal.name.slice(0, 32)}`,
            amountMinor,
            description: `Saved into goal: ${goal.name}`
          }], { session });
        } else {
          if (goal.currentMinor < amountMinor) {
            const err = new Error('Amount exceeds funds currently saved in this goal.');
            err.statusCode = 409;
            throw err;
          }
          const account = await Account.findOneAndUpdate(
            {
              accountNumber: goal.accountNumber,
              ownerUserId: req.authUser._id,
              status: 'active',
              balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - amountMinor }
            },
            { $inc: { balanceMinor: amountMinor } },
            { new: true, session }
          );
          if (!account) {
            const err = new Error('Linked account is not active.');
            err.statusCode = 409;
            throw err;
          }
          await User.updateOne(
            { _id: req.authUser._id, accountNumber: goal.accountNumber },
            { $inc: { balanceMinor: amountMinor } },
            { session }
          );

          const nextMinor = goal.currentMinor - amountMinor;
          const nextStatus = nextMinor >= goal.targetMinor ? 'completed' : 'active';
          updatedGoal = await SavingsGoal.findOneAndUpdate(
            { _id: goal._id, currentMinor: { $gte: amountMinor } },
            { $inc: { currentMinor: -amountMinor }, $set: { status: nextStatus } },
            { new: true, session }
          );

          const key = `goal-rel:${goal._id}:${crypto.randomUUID()}`;
          await Transaction.create([{
            type: 'goal_release',
            actorUserId: req.authUser._id,
            idempotencyKey: key,
            requestFingerprint: crypto.createHash('sha256').update(key).digest('hex'),
            fromAccount: `GOAL:${goal.name.slice(0, 32)}`,
            toAccount: goal.accountNumber,
            amountMinor,
            description: `Released from goal: ${goal.name}`
          }], { session });
        }
      });

      res.status(200).json({
        message: direction === 'deposit' ? 'Funds added to savings goal.' : 'Funds returned to your account.',
        goal: {
          id: String(updatedGoal._id),
          accountNumber: updatedGoal.accountNumber,
          name: updatedGoal.name,
          targetAmount: updatedGoal.targetMinor / 100,
          currentAmount: updatedGoal.currentMinor / 100,
          progressPercent: Math.min(100, Math.round((updatedGoal.currentMinor / updatedGoal.targetMinor) * 100)),
          currency: 'ZAR',
          status: updatedGoal.status,
          createdAt: updatedGoal.createdAt
        }
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      reportServerError(res, 'Savings goal allocation', error);
    } finally {
      if (session) await session.endSession();
    }
  });

  app.delete('/api/savings-goals/:id', requireCustomer, async (req, res) => {
    const { id } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid savings goal ID.' });
    }
    let session;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const goal = await SavingsGoal.findOne({ _id: id, ownerUserId: req.authUser._id }).session(session);
        if (!goal) {
          const err = new Error('Savings goal not found.');
          err.statusCode = 404;
          throw err;
        }
        if (goal.currentMinor > 0) {
          const account = await Account.findOneAndUpdate(
            {
              accountNumber: goal.accountNumber,
              ownerUserId: req.authUser._id,
              status: 'active',
              balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - goal.currentMinor }
            },
            { $inc: { balanceMinor: goal.currentMinor } },
            { new: true, session }
          );
          if (!account) {
            const err = new Error('Linked account must be active to return saved goal funds.');
            err.statusCode = 409;
            throw err;
          }
          await User.updateOne(
            { _id: req.authUser._id, accountNumber: goal.accountNumber },
            { $inc: { balanceMinor: goal.currentMinor } },
            { session }
          );
          const key = `goal-close:${goal._id}`;
          await Transaction.create([{
            type: 'goal_release',
            actorUserId: req.authUser._id,
            idempotencyKey: key,
            requestFingerprint: crypto.createHash('sha256').update(key).digest('hex'),
            fromAccount: `GOAL:${goal.name.slice(0, 32)}`,
            toAccount: goal.accountNumber,
            amountMinor: goal.currentMinor,
            description: `Closed savings goal: ${goal.name}`
          }], { session });
        }
        await SavingsGoal.deleteOne({ _id: goal._id }, { session });
      });
      res.status(200).json({ message: 'Savings goal closed and any remaining funds returned to your account.' });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      reportServerError(res, 'Savings goal deletion', error);
    } finally {
      if (session) await session.endSession();
    }
  });
}

module.exports = { registerCardsAndGoalsRoutes };
