const crypto = require('node:crypto');

function registerTransferFeatureRoutes(app, dependencies) {
  const {
    User,
    Account,
    Transaction,
    Beneficiary,
    ScheduledTransfer,
    PaymentRequest,
    mongoose,
    parseAmountMinor,
    transactionResponse,
    reportServerError,
    requireCustomer,
    notifyUser,
    logAudit
  } = dependencies;

  // 1. Account Lookup & Saved Beneficiaries
  app.get('/api/accounts/lookup/:accountNumber', requireCustomer, async (req, res) => {
    const { accountNumber } = req.params;
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Account number must be exactly 10 digits.' });
    }
    try {
      const account = await Account.findOne({
        accountNumber,
        status: { $in: ['active', 'frozen'] }
      }).populate('ownerUserId', 'name').lean();
      if (!account || !account.ownerUserId) {
        return res.status(404).json({ error: 'No active account found with that account number.' });
      }
      res.status(200).json({
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        holderName: account.ownerUserId.name
      });
    } catch (error) {
      reportServerError(res, 'Account lookup', error);
    }
  });

  app.get('/api/beneficiaries', requireCustomer, async (req, res) => {
    try {
      const beneficiaries = await Beneficiary.find({ ownerUserId: req.authUser._id })
        .sort({ name: 1, createdAt: -1 })
        .lean();
      res.status(200).json({
        beneficiaries: beneficiaries.map((item) => ({
          id: String(item._id),
          name: item.name,
          nickname: item.nickname || '',
          accountNumber: item.accountNumber,
          defaultReference: item.defaultReference || '',
          createdAt: item.createdAt
        }))
      });
    } catch (error) {
      reportServerError(res, 'Beneficiary listing', error);
    }
  });

  app.post('/api/beneficiaries', requireCustomer, async (req, res) => {
    const { accountNumber, nickname = '', defaultReference = '' } = req.body || {};
    if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber.trim())) {
      return res.status(400).json({ error: 'Enter a valid 10-digit beneficiary account number.' });
    }
    if (typeof nickname !== 'string' || nickname.trim().length > 60) {
      return res.status(400).json({ error: 'Nickname must be 60 characters or fewer.' });
    }
    if (typeof defaultReference !== 'string' || defaultReference.trim().length > 120) {
      return res.status(400).json({ error: 'Default reference must be 120 characters or fewer.' });
    }

    try {
      const targetAccount = await Account.findOne({
        accountNumber: accountNumber.trim(),
        status: 'active'
      }).populate('ownerUserId', 'name').lean();
      if (!targetAccount || !targetAccount.ownerUserId) {
        return res.status(404).json({ error: 'Beneficiary account was not found or is not active.' });
      }

      const beneficiary = await Beneficiary.create({
        ownerUserId: req.authUser._id,
        name: targetAccount.ownerUserId.name,
        nickname: nickname.trim(),
        accountNumber: targetAccount.accountNumber,
        defaultReference: defaultReference.trim()
      });
      await logAudit(req.authUser._id, 'beneficiary_added', `Added beneficiary ${beneficiary.name} (${beneficiary.accountNumber}).`, req);

      res.status(201).json({
        message: 'Beneficiary saved.',
        beneficiary: {
          id: String(beneficiary._id),
          name: beneficiary.name,
          nickname: beneficiary.nickname || '',
          accountNumber: beneficiary.accountNumber,
          defaultReference: beneficiary.defaultReference || '',
          createdAt: beneficiary.createdAt
        }
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'This account is already in your saved beneficiaries.' });
      }
      reportServerError(res, 'Beneficiary creation', error);
    }
  });

  app.delete('/api/beneficiaries/:id', requireCustomer, async (req, res) => {
    const { id } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid beneficiary ID.' });
    }
    try {
      const deleted = await Beneficiary.deleteOne({ _id: id, ownerUserId: req.authUser._id });
      if (deleted.deletedCount !== 1) {
        return res.status(404).json({ error: 'Beneficiary not found.' });
      }
      res.status(200).json({ message: 'Beneficiary removed.' });
    } catch (error) {
      reportServerError(res, 'Beneficiary deletion', error);
    }
  });

  // 2. Scheduled & Recurring Transfers (Standing Orders)
  app.get('/api/scheduled-transfers', requireCustomer, async (req, res) => {
    try {
      const schedules = await ScheduledTransfer.find({ ownerUserId: req.authUser._id })
        .sort({ status: 1, nextRunAt: 1, createdAt: -1 })
        .limit(50)
        .lean();
      res.status(200).json({
        scheduledTransfers: schedules.map((item) => ({
          id: String(item._id),
          fromAccount: item.fromAccount,
          toAccount: item.toAccount,
          amount: item.amountMinor / 100,
          currency: 'ZAR',
          description: item.description || '',
          frequency: item.frequency,
          nextRunAt: item.nextRunAt,
          status: item.status,
          lastError: item.lastError,
          lastExecutedAt: item.lastExecutedAt
        }))
      });
    } catch (error) {
      reportServerError(res, 'Scheduled transfer listing', error);
    }
  });

  app.post('/api/scheduled-transfers', requireCustomer, async (req, res) => {
    const { fromAccount, toAccount, amount, description = '', frequency = 'monthly', nextRunDate } = req.body || {};
    const amountMinor = parseAmountMinor(amount);
    if (typeof fromAccount !== 'string' || !/^\d{10}$/.test(fromAccount)) {
      return res.status(400).json({ error: 'Select a valid 10-digit source account.' });
    }
    if (typeof toAccount !== 'string' || !/^\d{10}$/.test(toAccount)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit destination account.' });
    }
    if (fromAccount === toAccount) {
      return res.status(400).json({ error: 'Source and destination accounts must be different.' });
    }
    if (amountMinor === null) {
      return res.status(400).json({ error: 'Enter a valid transfer amount greater than zero.' });
    }
    if (!['once', 'weekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ error: 'Frequency must be once, weekly, or monthly.' });
    }
    if (typeof description !== 'string' || description.trim().length > 120) {
      return res.status(400).json({ error: 'Reference must be 120 characters or fewer.' });
    }
    if (typeof nextRunDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nextRunDate)) {
      return res.status(400).json({ error: 'Provide a valid execution date in YYYY-MM-DD format.' });
    }
    const parsedRunDate = new Date(`${nextRunDate}T08:00:00.000Z`);
    if (Number.isNaN(parsedRunDate.getTime())) {
      return res.status(400).json({ error: 'Provide a valid execution date.' });
    }

    try {
      const [ownsSource, destExists] = await Promise.all([
        Account.exists({ accountNumber: fromAccount, ownerUserId: req.authUser._id, status: 'active' }),
        Account.exists({ accountNumber: toAccount, status: 'active' })
      ]);
      if (!ownsSource) {
        return res.status(403).json({ error: 'You can only schedule transfers from your own active account.' });
      }
      if (!destExists) {
        return res.status(404).json({ error: 'Destination account was not found or is not active.' });
      }

      const schedule = await ScheduledTransfer.create({
        ownerUserId: req.authUser._id,
        fromAccount,
        toAccount,
        amountMinor,
        description: description.trim(),
        frequency,
        nextRunAt: parsedRunDate,
        status: 'active'
      });

      res.status(201).json({
        message: 'Scheduled transfer created.',
        scheduledTransfer: {
          id: String(schedule._id),
          fromAccount: schedule.fromAccount,
          toAccount: schedule.toAccount,
          amount: schedule.amountMinor / 100,
          currency: 'ZAR',
          description: schedule.description || '',
          frequency: schedule.frequency,
          nextRunAt: schedule.nextRunAt,
          status: schedule.status
        }
      });
    } catch (error) {
      reportServerError(res, 'Scheduled transfer creation', error);
    }
  });

  app.delete('/api/scheduled-transfers/:id', requireCustomer, async (req, res) => {
    const { id } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid scheduled transfer ID.' });
    }
    try {
      const updated = await ScheduledTransfer.findOneAndUpdate(
        { _id: id, ownerUserId: req.authUser._id, status: 'active' },
        { $set: { status: 'cancelled' } },
        { new: true }
      );
      if (!updated) {
        return res.status(404).json({ error: 'Active scheduled transfer not found.' });
      }
      res.status(200).json({ message: 'Scheduled transfer cancelled.' });
    } catch (error) {
      reportServerError(res, 'Scheduled transfer cancellation', error);
    }
  });

  // 3. Payment Requests ("Pay Me")
  app.get('/api/payment-requests', requireCustomer, async (req, res) => {
    try {
      const [incoming, outgoing] = await Promise.all([
        PaymentRequest.find({ payerUserId: req.authUser._id }).sort({ createdAt: -1 }).limit(30).lean(),
        PaymentRequest.find({ requesterUserId: req.authUser._id }).sort({ createdAt: -1 }).limit(30).lean()
      ]);
      const formatRequest = (item) => ({
        id: String(item._id),
        requesterName: item.requesterName || 'Customer',
        payerName: item.payerName || 'Customer',
        fromAccount: item.fromAccount,
        toAccount: item.toAccount,
        amount: item.amountMinor / 100,
        currency: 'ZAR',
        description: item.description || '',
        status: item.status,
        createdAt: item.createdAt
      });
      res.status(200).json({
        incoming: incoming.map(formatRequest),
        outgoing: outgoing.map(formatRequest)
      });
    } catch (error) {
      reportServerError(res, 'Payment request listing', error);
    }
  });

  app.post('/api/payment-requests', requireCustomer, async (req, res) => {
    const { payerAccountNumber, receivingAccountNumber, amount, description = '' } = req.body || {};
    const amountMinor = parseAmountMinor(amount);
    if (typeof payerAccountNumber !== 'string' || !/^\d{10}$/.test(payerAccountNumber)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit payer account number.' });
    }
    if (typeof receivingAccountNumber !== 'string' || !/^\d{10}$/.test(receivingAccountNumber)) {
      return res.status(400).json({ error: 'Select a valid 10-digit receiving account.' });
    }
    if (payerAccountNumber === receivingAccountNumber) {
      return res.status(400).json({ error: 'Payer and receiving accounts must be different.' });
    }
    if (amountMinor === null) {
      return res.status(400).json({ error: 'Enter a valid request amount greater than zero.' });
    }
    if (typeof description !== 'string' || description.trim().length > 120) {
      return res.status(400).json({ error: 'Description must be 120 characters or fewer.' });
    }

    try {
      const [receivingAccount, payerAccount] = await Promise.all([
        Account.findOne({ accountNumber: receivingAccountNumber, ownerUserId: req.authUser._id, status: 'active' }).lean(),
        Account.findOne({ accountNumber: payerAccountNumber, status: 'active' }).populate('ownerUserId', 'name').lean()
      ]);
      if (!receivingAccount) {
        return res.status(403).json({ error: 'You can only receive funds into your own active account.' });
      }
      if (!payerAccount || !payerAccount.ownerUserId) {
        return res.status(404).json({ error: 'Payer account was not found or is not active.' });
      }
      if (String(payerAccount.ownerUserId._id) === String(req.authUser._id)) {
        return res.status(400).json({ error: 'Use a normal transfer to move funds between your own accounts.' });
      }

      const paymentRequest = await PaymentRequest.create({
        requesterUserId: req.authUser._id,
        payerUserId: payerAccount.ownerUserId._id,
        requesterName: req.authUser.name,
        payerName: payerAccount.ownerUserId.name,
        fromAccount: payerAccount.accountNumber,
        toAccount: receivingAccount.accountNumber,
        amountMinor,
        description: description.trim(),
        status: 'pending'
      });

      await notifyUser(
        payerAccount.ownerUserId._id,
        'payment_request',
        `${req.authUser.name} requested R ${(amountMinor / 100).toFixed(2)} from account ${payerAccount.accountNumber}.`,
        'paymentRequest:received',
        { requestId: String(paymentRequest._id) }
      );

      res.status(201).json({
        message: 'Payment request sent.',
        paymentRequest: {
          id: String(paymentRequest._id),
          requesterName: paymentRequest.requesterName,
          payerName: paymentRequest.payerName,
          fromAccount: paymentRequest.fromAccount,
          toAccount: paymentRequest.toAccount,
          amount: paymentRequest.amountMinor / 100,
          currency: 'ZAR',
          description: paymentRequest.description,
          status: paymentRequest.status,
          createdAt: paymentRequest.createdAt
        }
      });
    } catch (error) {
      reportServerError(res, 'Payment request creation', error);
    }
  });

  app.post('/api/payment-requests/:id/respond', requireCustomer, async (req, res) => {
    const { id } = req.params;
    const { action } = req.body || {};
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid payment request ID.' });
    }
    if (!['pay', 'decline', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'Action must be pay, decline, or cancel.' });
    }

    let session;
    try {
      const requestDoc = await PaymentRequest.findById(id).lean();
      if (!requestDoc) {
        return res.status(404).json({ error: 'Payment request not found.' });
      }
      if (requestDoc.status !== 'pending') {
        return res.status(409).json({ error: `This payment request is already ${requestDoc.status}.` });
      }

      const isPayer = String(requestDoc.payerUserId) === String(req.authUser._id);
      const isRequester = String(requestDoc.requesterUserId) === String(req.authUser._id);

      if (action === 'cancel') {
        if (!isRequester) {
          return res.status(403).json({ error: 'Only the requester can cancel this payment request.' });
        }
        await PaymentRequest.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'cancelled' } });
        return res.status(200).json({ message: 'Payment request cancelled.' });
      }

      if (!isPayer) {
        return res.status(403).json({ error: 'Only the requested payer can approve or decline this request.' });
      }

      if (action === 'decline') {
        await PaymentRequest.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'declined' } });
        await notifyUser(
          requestDoc.requesterUserId,
          'payment_request',
          `${req.authUser.name} declined your R ${(requestDoc.amountMinor / 100).toFixed(2)} payment request.`
        );
        return res.status(200).json({ message: 'Payment request declined.' });
      }

      let savedTransaction;
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const lockedRequest = await PaymentRequest.findOneAndUpdate(
          { _id: id, payerUserId: req.authUser._id, status: 'pending' },
          { $set: { status: 'paid' } },
          { new: true, session }
        );
        if (!lockedRequest) {
          const err = new Error('Payment request is no longer pending.');
          err.statusCode = 409;
          throw err;
        }

        const fromAccount = await Account.findOneAndUpdate(
          {
            accountNumber: lockedRequest.fromAccount,
            ownerUserId: req.authUser._id,
            status: 'active',
            balanceMinor: { $gte: lockedRequest.amountMinor }
          },
          { $inc: { balanceMinor: -lockedRequest.amountMinor } },
          { new: true, session }
        );
        if (!fromAccount) {
          const err = new Error('Insufficient funds or inactive source account.');
          err.statusCode = 409;
          throw err;
        }

        const toAccount = await Account.findOneAndUpdate(
          {
            accountNumber: lockedRequest.toAccount,
            status: 'active',
            balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - lockedRequest.amountMinor }
          },
          { $inc: { balanceMinor: lockedRequest.amountMinor } },
          { new: true, session }
        );
        if (!toAccount) {
          const err = new Error('Destination account is no longer active.');
          err.statusCode = 404;
          throw err;
        }

        await User.updateOne(
          { _id: fromAccount.ownerUserId, accountNumber: lockedRequest.fromAccount },
          { $inc: { balanceMinor: -lockedRequest.amountMinor } },
          { session }
        );
        await User.updateOne(
          { _id: toAccount.ownerUserId, accountNumber: lockedRequest.toAccount },
          { $inc: { balanceMinor: lockedRequest.amountMinor } },
          { session }
        );

        const idempotencyKey = `payreq:${lockedRequest._id}`;
        const requestFingerprint = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
        const [tx] = await Transaction.create([{
          type: 'transfer',
          actorUserId: req.authUser._id,
          idempotencyKey,
          requestFingerprint,
          fromAccount: lockedRequest.fromAccount,
          toAccount: lockedRequest.toAccount,
          amountMinor: lockedRequest.amountMinor,
          description: lockedRequest.description || `Payment request from ${lockedRequest.requesterName}`
        }], { session });
        savedTransaction = tx;

        await PaymentRequest.updateOne(
          { _id: lockedRequest._id },
          { $set: { transactionId: tx._id } },
          { session }
        );
      });

      const amountLabel = `R ${(requestDoc.amountMinor / 100).toFixed(2)}`;
      await notifyUser(
        requestDoc.requesterUserId,
        'payment_request',
        `${req.authUser.name} paid your ${amountLabel} request into ${requestDoc.toAccount}.`,
        'transfer:completed',
        { transactionId: String(savedTransaction._id) }
      );
      await notifyUser(
        req.authUser._id,
        'transfer',
        `Paid ${amountLabel} to ${requestDoc.requesterName} (${requestDoc.toAccount}).`,
        'transfer:completed',
        { transactionId: String(savedTransaction._id) }
      );

      res.status(200).json({
        message: 'Payment request paid.',
        transaction: transactionResponse(savedTransaction)
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      reportServerError(res, 'Payment request response', error);
    } finally {
      if (session) await session.endSession();
    }
  });
}

module.exports = { registerTransferFeatureRoutes };
