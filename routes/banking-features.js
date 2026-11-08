const crypto = require('node:crypto');
const { advanceScheduleDate, createSchedulerService } = require('../services/scheduler-service');
const { registerTransferFeatureRoutes } = require('./beneficiaries');
const { registerCardsAndGoalsRoutes } = require('./cards-and-goals');

function registerBankingFeatureRoutes(app, dependencies) {
  const {
    requireAdmin,
    User,
    Account,
    Transaction,
    Beneficiary,
    ScheduledTransfer,
    PaymentRequest,
    VirtualCard,
    SavingsGoal,
    Dispute,
    AuditLog,
    Notification,
    mongoose,
    io,
    SYSTEM_ACTOR_USER_ID,
    parseAmountMinor,
    transactionResponse,
    reportServerError
  } = dependencies;

  function requireCustomer(req, res, next) {
    if (req.authUser?.role === 'admin') {
      return res.status(403).json({ error: 'This banking feature is available to customer accounts only.' });
    }
    return next();
  }

  async function notifyUser(userId, type, message, socketEvent = 'notification:new', payload = {}) {
    if (!userId) return;
    try {
      if (Notification?.create) {
        await Notification.create({ userId, type, message, read: false });
      }
      if (io?.to) {
        io.to(`user:${userId}`).emit(socketEvent, { message, type, ...payload });
      }
    } catch {
      // Do not block primary operation if notification persistence fails.
    }
  }

  async function logAudit(userId, action, detail, req) {
    if (!AuditLog?.create || !userId) return;
    try {
      const ipAddress = typeof req?.ip === 'string' ? req.ip.slice(0, 80) : '';
      const userAgent = typeof req?.get === 'function' ? String(req.get('user-agent') || '').slice(0, 180) : '';
      await AuditLog.create({ userId, action, detail, ipAddress, userAgent });
    } catch {
      // Ignore optional audit errors.
    }
  }

  registerTransferFeatureRoutes(app, {
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
  });

  registerCardsAndGoalsRoutes(app, {
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
  });

  const { processDueScheduledTransfers } = createSchedulerService({
    ScheduledTransfer,
    Account,
    User,
    Transaction,
    mongoose,
    notifyUser
  });

  // 6. Account Freeze & Transaction Dispute / Reversal Workflow
  app.get('/api/disputes', async (req, res) => {
    try {
      const filter = req.authUser.role === 'admin'
        ? {}
        : { reporterUserId: req.authUser._id };
      if (typeof req.query.status === 'string' && ['open', 'resolved', 'rejected'].includes(req.query.status)) {
        filter.status = req.query.status;
      }
      const disputes = await Dispute.find(filter)
        .populate('reporterUserId', 'name email userId')
        .populate('transactionId', 'type fromAccount toAccount amountMinor description createdAt')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      res.status(200).json({
        disputes: disputes.map((item) => ({
          id: String(item._id),
          reporterName: item.reporterUserId?.name || 'Customer',
          reporterEmail: item.reporterUserId?.email || '',
          accountNumber: item.accountNumber,
          transactionId: item.transactionId?._id ? String(item.transactionId._id) : String(item.transactionId),
          transactionAmount: item.transactionId?.amountMinor ? item.transactionId.amountMinor / 100 : null,
          fromAccount: item.transactionId?.fromAccount || '',
          toAccount: item.transactionId?.toAccount || '',
          reason: item.reason,
          status: item.status,
          resolutionNote: item.resolutionNote || '',
          reversed: Boolean(item.reversalTransactionId),
          createdAt: item.createdAt
        }))
      });
    } catch (error) {
      reportServerError(res, 'Dispute listing', error);
    }
  });

  app.post('/api/disputes', requireCustomer, async (req, res) => {
    const { transactionId, reason } = req.body || {};
    if (typeof transactionId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(transactionId)) {
      return res.status(400).json({ error: 'Provide a valid transaction ID to dispute.' });
    }
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 300) {
      return res.status(400).json({ error: 'Provide a dispute reason between 5 and 300 characters.' });
    }

    try {
      const [transaction, userAccounts, existingDispute] = await Promise.all([
        Transaction.findById(transactionId).lean(),
        Account.find({ ownerUserId: req.authUser._id }).select('accountNumber').lean(),
        Dispute.findOne({ transactionId, reporterUserId: req.authUser._id }).lean()
      ]);
      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found.' });
      }
      if (existingDispute) {
        return res.status(409).json({ error: 'You have already submitted a dispute for this transaction.' });
      }
      const ownedNumbers = new Set(userAccounts.map((acc) => acc.accountNumber));
      const matchedAccount = ownedNumbers.has(transaction.fromAccount)
        ? transaction.fromAccount
        : ownedNumbers.has(transaction.toAccount)
          ? transaction.toAccount
          : null;
      if (!matchedAccount) {
        return res.status(403).json({ error: 'You can only dispute transactions belonging to your accounts.' });
      }

      const dispute = await Dispute.create({
        reporterUserId: req.authUser._id,
        transactionId: transaction._id,
        accountNumber: matchedAccount,
        reason: reason.trim(),
        status: 'open'
      });
      await logAudit(req.authUser._id, 'dispute_submitted', `Disputed transaction ${transactionId} on ${matchedAccount}.`, req);

      res.status(201).json({
        message: 'Transaction dispute submitted for administrator review.',
        dispute: {
          id: String(dispute._id),
          accountNumber: dispute.accountNumber,
          transactionId: String(dispute.transactionId),
          reason: dispute.reason,
          status: dispute.status,
          createdAt: dispute.createdAt
        }
      });
    } catch (error) {
      reportServerError(res, 'Dispute submission', error);
    }
  });

  app.patch('/api/admin/disputes/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, resolutionNote = '', reverseTransaction = false } = req.body || {};
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid dispute ID.' });
    }
    if (!['resolved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Dispute status must be resolved or rejected.' });
    }
    if (typeof resolutionNote !== 'string' || resolutionNote.trim().length > 300) {
      return res.status(400).json({ error: 'Resolution note must be 300 characters or fewer.' });
    }

    let session;
    try {
      let updatedDispute;
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const dispute = await Dispute.findOne({ _id: id, status: 'open' }).session(session);
        if (!dispute) {
          const err = new Error('Open dispute not found.');
          err.statusCode = 404;
          throw err;
        }

        let reversalTxId = null;
        if (status === 'resolved' && reverseTransaction) {
          const originalTx = await Transaction.findById(dispute.transactionId).session(session);
          if (!originalTx || originalTx.type !== 'transfer' ||
              !/^\d{10}$/.test(originalTx.fromAccount || '') ||
              !/^\d{10}$/.test(originalTx.toAccount || '')) {
            const err = new Error('Only standard account-to-account transfers can be reversed automatically.');
            err.statusCode = 400;
            throw err;
          }

          const recipientAccount = await Account.findOneAndUpdate(
            {
              accountNumber: originalTx.toAccount,
              status: { $in: ['active', 'frozen'] },
              balanceMinor: { $gte: originalTx.amountMinor }
            },
            { $inc: { balanceMinor: -originalTx.amountMinor } },
            { new: true, session }
          );
          if (!recipientAccount) {
            const err = new Error('Recipient account does not have sufficient funds for automatic reversal.');
            err.statusCode = 409;
            throw err;
          }

          const senderAccount = await Account.findOneAndUpdate(
            {
              accountNumber: originalTx.fromAccount,
              status: { $in: ['active', 'frozen'] },
              balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - originalTx.amountMinor }
            },
            { $inc: { balanceMinor: originalTx.amountMinor } },
            { new: true, session }
          );
          if (!senderAccount) {
            const err = new Error('Original sender account is closed or cannot receive the reversal.');
            err.statusCode = 409;
            throw err;
          }

          await User.updateOne(
            { _id: recipientAccount.ownerUserId, accountNumber: originalTx.toAccount },
            { $inc: { balanceMinor: -originalTx.amountMinor } },
            { session }
          );
          await User.updateOne(
            { _id: senderAccount.ownerUserId, accountNumber: originalTx.fromAccount },
            { $inc: { balanceMinor: originalTx.amountMinor } },
            { session }
          );

          const idempotencyKey = `reversal:${dispute._id}`;
          const [reversalTx] = await Transaction.create([{
            type: 'reversal',
            actorUserId: req.authUser._id || SYSTEM_ACTOR_USER_ID,
            idempotencyKey,
            requestFingerprint: crypto.createHash('sha256').update(idempotencyKey).digest('hex'),
            fromAccount: originalTx.toAccount,
            toAccount: originalTx.fromAccount,
            amountMinor: originalTx.amountMinor,
            description: `Dispute reversal for transaction ${String(originalTx._id).slice(-6)}`
          }], { session });
          reversalTxId = reversalTx._id;
        }

        updatedDispute = await Dispute.findOneAndUpdate(
          { _id: dispute._id },
          {
            $set: {
              status,
              resolutionNote: resolutionNote.trim(),
              reversalTransactionId: reversalTxId
            }
          },
          { new: true, session }
        );
      });

      await notifyUser(
        updatedDispute.reporterUserId,
        'dispute',
        `Your transaction dispute on account ${updatedDispute.accountNumber} was ${status}${updatedDispute.reversalTransactionId ? ' and funds were reversed' : ''}.`
      );

      res.status(200).json({
        message: `Dispute ${status}.`,
        dispute: {
          id: String(updatedDispute._id),
          status: updatedDispute.status,
          resolutionNote: updatedDispute.resolutionNote,
          reversed: Boolean(updatedDispute.reversalTransactionId)
        }
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      reportServerError(res, 'Dispute resolution', error);
    } finally {
      if (session) await session.endSession();
    }
  });

  app.patch('/api/admin/accounts/:accountNumber/status', requireAdmin, async (req, res) => {
    const { accountNumber } = req.params;
    const { status } = req.body || {};
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Account number must be exactly 10 digits.' });
    }
    if (!['active', 'frozen'].includes(status)) {
      return res.status(400).json({ error: 'Account status must be active or frozen.' });
    }

    try {
      const account = await Account.findOneAndUpdate(
        { accountNumber, status: { $in: ['active', 'frozen'] } },
        { $set: { status } },
        { new: true }
      );
      if (!account) {
        return res.status(404).json({ error: 'Active or frozen account not found.' });
      }
      await notifyUser(
        account.ownerUserId,
        'security',
        status === 'frozen'
          ? `Account ${accountNumber} has been temporarily frozen by an administrator.`
          : `Account ${accountNumber} has been unfrozen and restored to active status.`
      );
      await logAudit(
        account.ownerUserId,
        status === 'frozen' ? 'account_frozen' : 'account_unfrozen',
        `Administrator set account ${accountNumber} status to ${status}.`,
        req
      );

      res.status(200).json({
        message: `Account ${accountNumber} is now ${status}.`,
        account: {
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          status: account.status,
          balance: account.balanceMinor / 100
        }
      });
    } catch (error) {
      reportServerError(res, 'Account status update', error);
    }
  });

  // 7. Persistent Notification Inbox
  app.get('/api/notifications', async (req, res) => {
    try {
      const [notifications, unreadCount] = await Promise.all([
        Notification.find({ userId: req.authUser._id })
          .sort({ createdAt: -1 })
          .limit(30)
          .lean(),
        Notification.countDocuments({ userId: req.authUser._id, read: false })
      ]);
      res.status(200).json({
        unreadCount,
        notifications: notifications.map((item) => ({
          id: String(item._id),
          type: item.type,
          message: item.message,
          read: item.read,
          createdAt: item.createdAt
        }))
      });
    } catch (error) {
      reportServerError(res, 'Notification listing', error);
    }
  });

  app.post('/api/notifications/read-all', async (req, res) => {
    try {
      await Notification.updateMany(
        { userId: req.authUser._id, read: false },
        { $set: { read: true } }
      );
      res.status(200).json({ message: 'All notifications marked as read.' });
    } catch (error) {
      reportServerError(res, 'Notification mark-all-read', error);
    }
  });

  return { processDueScheduledTransfers };
}

module.exports = { registerBankingFeatureRoutes, advanceScheduleDate };
