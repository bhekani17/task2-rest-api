const crypto = require('node:crypto');

function registerTransactionRoutes(app, dependencies) {
  const {
    User, Account, Transaction, reportServerError, mongoose, io,
    ownedAccountNumbers, buildTransactionFilter, transactionCsv,
    parseTransactionPagination, transactionResponse, parseAmountMinor
  } = dependencies;

  // Export a bounded CSV statement using the same ownership and filters as transaction search.
  app.get('/api/transactions.csv', async (req, res) => {
    try {
      const accountNumbers = await ownedAccountNumbers(req.authUser);
      const parsed = buildTransactionFilter(req.query, req.authUser, accountNumbers || undefined);
      if (parsed.error) {
        return res.status(parsed.error.status).json({ error: parsed.error.message });
      }
      if (req.query.accountNumber && req.authUser.role === 'admin' &&
          !await Account.exists({ accountNumber: req.query.accountNumber, status: 'active' })) {
        return res.status(404).json({ error: 'Account not found.' });
      }
  
      const transactions = await Transaction.find(parsed.filter)
        .select('createdAt type fromAccount toAccount amountMinor description')
        .sort({ createdAt: -1, _id: -1 })
        .limit(5001)
        .lean();
      if (transactions.length > 5000) {
        const hasDateRange = typeof req.query.from === 'string' &&
          typeof req.query.to === 'string' &&
          Boolean(req.query.from) && Boolean(req.query.to);
        return res.status(413).json({
          error: hasDateRange
            ? 'This date range still contains more than 5,000 transactions. Narrow the date range and try again.'
            : 'This statement exceeds 5,000 transactions. Select both a start and end date, then try again.'
        });
      }
  
      const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="sky-bank-statement-${today}.csv"`);
      res.status(200).send(transactionCsv(transactions));
    } catch (error) {
      reportServerError(res, 'Statement export', error);
    }
  });
  
  // GET /api/transactions returns a filtered page of ledger entries.
  app.get('/api/transactions', async (req, res) => {
    try {
      const accountNumbers = await ownedAccountNumbers(req.authUser);
      const parsed = buildTransactionFilter(req.query, req.authUser, accountNumbers || undefined);
      if (parsed.error) {
        return res.status(parsed.error.status).json({ error: parsed.error.message });
      }
  
      const pagination = parseTransactionPagination(req.query);
      if (pagination.error) {
        return res.status(pagination.error.status).json({ error: pagination.error.message });
      }
      const { page, limit } = pagination;
      const filter = parsed.filter;
      if (req.query.accountNumber && req.authUser.role === 'admin' &&
          !await Account.exists({ accountNumber: req.query.accountNumber, status: 'active' })) {
        return res.status(404).json({ error: 'Account not found.' });
      }
  
      const [transactions, total] = await Promise.all([
        Transaction.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Transaction.countDocuments(filter)
      ]);
      res.set({
        'X-Total-Count': String(total),
        'X-Page': String(page),
        'X-Page-Size': String(limit),
        'X-Has-More': String(page * limit < total)
      });
      res.status(200).json(transactions.map(transactionResponse));
    } catch (error) {
      reportServerError(res, 'Transaction listing', error);
    }
  });
  
  // GET /api/accounts/:accountNumber/transactions returns one account's ledger history.
  app.get('/api/accounts/:accountNumber/transactions', async (req, res) => {
    const { accountNumber } = req.params;
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Account number must be exactly 10 digits.' });
    }
  
    try {
      const accountFilter = req.authUser.role === 'admin'
        ? { accountNumber, status: 'active' }
        : { accountNumber, ownerUserId: req.authUser._id, status: 'active' };
      const account = await Account.findOne(accountFilter).select('accountNumber').lean();
      if (!account) {
        return res.status(req.authUser.role === 'admin' ? 404 : 403).json({
          error: req.authUser.role === 'admin' ? 'Account not found.' : 'You do not have access to this account.'
        });
      }
  
      const transactions = await Transaction.find({
        $or: [{ fromAccount: accountNumber }, { toAccount: accountNumber }]
      }).sort({ createdAt: -1 }).limit(100).lean();
      res.status(200).json(transactions.map(transactionResponse));
    } catch (error) {
      reportServerError(res, 'Account transaction listing', error);
    }
  });
  
  // POST /api/transactions applies a ledger operation and its balance changes atomically.
  app.post('/api/transactions', async (req, res) => {
    const { type, accountNumber, destinationAccountNumber, description = '' } = req.body || {};
    if (req.authUser.role === 'admin') {
      return res.status(403).json({ error: 'Administrators cannot create transactions.' });
    }
    const amountMinor = parseAmountMinor(req.body?.amount);
    const idempotencyKey = req.get('Idempotency-Key');
    if (!['deposit', 'withdrawal', 'transfer'].includes(type)) {
      return res.status(400).json({ error: 'Transaction type must be deposit, withdrawal, or transfer.' });
    }
    if (type === 'deposit' && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Simulated deposits are disabled in production.' });
    }
    if (type === 'withdrawal') {
      return res.status(501).json({ error: 'Withdrawals require a configured, authorized banking provider.' });
    }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: 'A valid Idempotency-Key header is required for money transactions.' });
    }
    if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'A valid 10-digit account number is required.' });
    }
    if (amountMinor === null) {
      return res.status(400).json({ error: 'Amount must be greater than zero and have at most two decimal places.' });
    }
    if (typeof description !== 'string' || description.length > 120) {
      return res.status(400).json({ error: 'Description must be 120 characters or fewer.' });
    }
    if (type === 'transfer' && (typeof destinationAccountNumber !== 'string' || !/^\d{10}$/.test(destinationAccountNumber))) {
      return res.status(400).json({ error: 'A valid destination account number is required for transfers.' });
    }
    if (type === 'transfer' && accountNumber === destinationAccountNumber) {
      return res.status(400).json({ error: 'Source and destination accounts must be different.' });
    }
    if (type === 'deposit' || req.authUser.role !== 'admin') {
      const sourceAccount = await Account.exists({
        accountNumber,
        ownerUserId: req.authUser._id,
        status: 'active'
      });
      if (!sourceAccount) {
        return res.status(403).json({
          error: type === 'deposit'
            ? 'Demo deposits can only be made to your own account.'
            : 'You do not have access to the source account.'
        });
      }
    }
  
    const requestFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ type, accountNumber, destinationAccountNumber, amountMinor, description: description.trim() }))
      .digest('hex');
    const existingTransaction = await Transaction.findOne({
      actorUserId: req.authUser._id,
      idempotencyKey
    });
    if (existingTransaction) {
      if (existingTransaction.requestFingerprint !== requestFingerprint) {
        return res.status(409).json({ error: 'This Idempotency-Key was already used for a different transaction.' });
      }
      return res.status(200).json({
        transaction: transactionResponse(existingTransaction),
        message: type === 'deposit'
          ? 'Demo deposit already processed; these funds are simulated.'
          : 'Transfer already processed.'
      });
    }
  
    let session;
    let savedTransaction;
    let senderUserId;
    let recipientUserId;
  
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        let fromAccount = null;
        let toAccount = null;
  
        if (type === 'deposit') {
          toAccount = await Account.findOneAndUpdate(
            {
              ownerUserId: req.authUser._id,
              accountNumber,
              status: 'active',
              balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - amountMinor }
            },
            { $inc: { balanceMinor: amountMinor } },
            { new: true, session }
          );
          if (!toAccount) {
            const exists = await Account.exists({
              ownerUserId: req.authUser._id,
              accountNumber,
              status: 'active'
            }).session(session);
            const error = new Error(exists ? 'Account balance limit exceeded.' : 'Account not found.');
            error.statusCode = exists ? 409 : 404;
            throw error;
          }
          recipientUserId = String(toAccount.ownerUserId);
          await User.updateOne(
            { _id: req.authUser._id, accountNumber },
            { $inc: { balanceMinor: amountMinor } },
            { session }
          );
        } else {
          fromAccount = await Account.findOneAndUpdate(
            { accountNumber, status: 'active', balanceMinor: { $gte: amountMinor } },
            { $inc: { balanceMinor: -amountMinor } },
            { new: true, session }
          );
          if (!fromAccount) {
            const exists = await Account.exists({ accountNumber, status: 'active' }).session(session);
            const error = new Error(exists ? 'Insufficient funds.' : 'Account not found.');
            error.statusCode = exists ? 409 : 404;
            throw error;
          }
          senderUserId = String(fromAccount.ownerUserId);
          await User.updateOne(
            { _id: fromAccount.ownerUserId, accountNumber },
            { $inc: { balanceMinor: -amountMinor } },
            { session }
          );
  
          toAccount = await Account.findOneAndUpdate(
            {
              accountNumber: destinationAccountNumber,
              status: 'active',
              balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - amountMinor }
            },
            { $inc: { balanceMinor: amountMinor } },
            { new: true, session }
          );
          if (!toAccount) {
            const exists = await Account.exists({
              accountNumber: destinationAccountNumber,
              status: 'active'
            }).session(session);
            const error = new Error(exists ? 'Destination balance limit exceeded.' : 'Destination account not found.');
            error.statusCode = exists ? 409 : 404;
            throw error;
          }
          recipientUserId = String(toAccount.ownerUserId);
          await User.updateOne(
            { _id: toAccount.ownerUserId, accountNumber: destinationAccountNumber },
            { $inc: { balanceMinor: amountMinor } },
            { session }
          );
        }
  
        const [transaction] = await Transaction.create([{
          type,
          actorUserId: req.authUser._id,
          idempotencyKey,
          requestFingerprint,
          fromAccount: type === 'deposit' ? 'DEMO-FUNDING' : accountNumber,
          toAccount: type === 'deposit' ? accountNumber : destinationAccountNumber,
          amountMinor,
          description: type === 'deposit' ? 'Simulated demo deposit' : description.trim()
        }], { session });
        savedTransaction = transaction;
      });
  
      const eventName = type === 'deposit' ? 'deposit:completed' : 'transfer:completed';
      const eventMessage = type === 'deposit'
        ? 'A simulated demo deposit has been added to your account.'
        : 'An incoming transfer has been completed.';
      if (senderUserId) {
        io.to(`user:${senderUserId}`).emit('transfer:completed', {
          message: 'Your transfer has been completed.',
          transactionId: String(savedTransaction._id)
        });
      }
      io.to(`user:${recipientUserId}`).emit(eventName, {
        message: eventMessage,
        transactionId: String(savedTransaction._id)
      });
      res.status(201).json({
        transaction: transactionResponse(savedTransaction),
        message: type === 'deposit'
          ? 'Demo deposit completed. These funds are simulated and are not real money.'
          : 'Transfer completed.'
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      if (error.code === 11000) {
        const priorTransaction = await Transaction.findOne({
          actorUserId: req.authUser._id,
          idempotencyKey
        });
        if (priorTransaction?.requestFingerprint === requestFingerprint) {
          return res.status(200).json({
            transaction: transactionResponse(priorTransaction),
            message: type === 'deposit'
              ? 'Demo deposit already processed; these funds are simulated.'
              : 'Transfer already processed.'
          });
        }
        if (priorTransaction) {
          return res.status(409).json({ error: 'This Idempotency-Key was already used for a different transaction.' });
        }
      }
      if (error.code === 20 || /transaction numbers are only allowed/i.test(String(error?.message || ''))) {
        return res.status(503).json({
          error: 'Bank transactions require MongoDB running as a replica set. Use MongoDB Atlas or configure a local replica set.'
        });
      }
      reportServerError(res, type === 'deposit' ? 'Demo deposit' : 'Transfer', error);
    } finally {
      if (session) await session.endSession();
    }
  });
  
  // GET /api/users/:id fetches one document by its five-digit public ID.
  // The regex makes sure the URL uses exactly five numeric characters before querying MongoDB.
}

module.exports = { registerTransactionRoutes };
