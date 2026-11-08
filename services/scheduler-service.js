const crypto = require('node:crypto');

function advanceScheduleDate(date, frequency) {
  const next = new Date(date.getTime());
  if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else if (frequency === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

function createSchedulerService({ ScheduledTransfer, Account, User, Transaction, mongoose, notifyUser }) {
  async function processDueScheduledTransfers(now = new Date()) {
    if (!ScheduledTransfer?.find) return;
    const dueTransfers = await ScheduledTransfer.find({
      status: 'active',
      nextRunAt: { $lte: now }
    }).limit(25).lean();

    for (const item of dueTransfers) {
      let session;
      try {
        session = await mongoose.startSession();
        let executed = false;
        let recipientUserId = null;

        await session.withTransaction(async () => {
          const schedule = await ScheduledTransfer.findOne({
            _id: item._id,
            status: 'active',
            nextRunAt: { $lte: now }
          }).session(session);
          if (!schedule) return;

          const fromAcc = await Account.findOneAndUpdate(
            {
              accountNumber: schedule.fromAccount,
              ownerUserId: schedule.ownerUserId,
              status: 'active',
              balanceMinor: { $gte: schedule.amountMinor }
            },
            { $inc: { balanceMinor: -schedule.amountMinor } },
            { new: true, session }
          );
          if (!fromAcc) {
            await ScheduledTransfer.updateOne(
              { _id: schedule._id },
              { $set: { status: 'failed', lastError: 'Insufficient funds or inactive source account.' } },
              { session }
            );
            return;
          }

          const toAcc = await Account.findOneAndUpdate(
            {
              accountNumber: schedule.toAccount,
              status: 'active',
              balanceMinor: { $lte: Number.MAX_SAFE_INTEGER - schedule.amountMinor }
            },
            { $inc: { balanceMinor: schedule.amountMinor } },
            { new: true, session }
          );
          if (!toAcc) {
            throw new Error('Destination account unavailable for scheduled transfer.');
          }
          recipientUserId = toAcc.ownerUserId;

          await User.updateOne(
            { _id: fromAcc.ownerUserId, accountNumber: schedule.fromAccount },
            { $inc: { balanceMinor: -schedule.amountMinor } },
            { session }
          );
          await User.updateOne(
            { _id: toAcc.ownerUserId, accountNumber: schedule.toAccount },
            { $inc: { balanceMinor: schedule.amountMinor } },
            { session }
          );

          const runStamp = schedule.nextRunAt.toISOString().slice(0, 10);
          const idempotencyKey = `sched:${schedule._id}:${runStamp}`;
          const requestFingerprint = crypto.createHash('sha256')
            .update(idempotencyKey)
            .digest('hex');

          await Transaction.create([{
            type: 'transfer',
            actorUserId: schedule.ownerUserId,
            idempotencyKey,
            requestFingerprint,
            fromAccount: schedule.fromAccount,
            toAccount: schedule.toAccount,
            amountMinor: schedule.amountMinor,
            description: schedule.description || `Standing order (${schedule.frequency})`
          }], { session });

          const updates = {
            lastExecutedAt: now,
            lastError: null
          };
          if (schedule.frequency === 'once') {
            updates.status = 'completed';
          } else {
            updates.nextRunAt = advanceScheduleDate(schedule.nextRunAt, schedule.frequency);
          }
          await ScheduledTransfer.updateOne({ _id: schedule._id }, { $set: updates }, { session });
          executed = true;
        });

        if (executed) {
          const amountLabel = `R ${(item.amountMinor / 100).toFixed(2)}`;
          await notifyUser(
            item.ownerUserId,
            'scheduled_transfer',
            `Scheduled transfer of ${amountLabel} to ${item.toAccount} completed.`,
            'transfer:completed'
          );
          if (recipientUserId) {
            await notifyUser(
              recipientUserId,
              'transfer',
              `Incoming transfer of ${amountLabel} received into ${item.toAccount}.`,
              'transfer:completed'
            );
          }
        }
      } catch {
        // Leave for next cycle if a transient database error occurred.
      } finally {
        if (session) await session.endSession();
      }
    }
  }

  return { processDueScheduledTransfers };
}

module.exports = { advanceScheduleDate, createSchedulerService };
