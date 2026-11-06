const crypto = require('node:crypto');
const { calculateHoldingsTrade, defaultMarketClient } = require('../services/stock-market');

const PORTFOLIO_ACCOUNT = 'JSE-INVESTMENT-PORTFOLIO';

function registerInvestmentRoutes(app, dependencies) {
  const {
    User, Account, Transaction, StockPortfolio, StockTrade, mongoose, reportServerError,
    marketClient = defaultMarketClient
  } = dependencies;

  function requireCustomer(req, res, next) {
    if (req.authUser.role !== 'customer') {
      return res.status(403).json({ error: 'Simulated investing is available to customer accounts only.' });
    }
    next();
  }

  async function getOrCreatePortfolio(userId) {
    let portfolio;
    try {
      portfolio = await StockPortfolio.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, portfolioType: 'bank-funded', holdings: [] } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      portfolio = await StockPortfolio.findOne({ userId }).lean();
    }
    if (!portfolio || (portfolio.portfolioType === 'bank-funded' && portfolio.virtualCashMinor === undefined)) {
      return portfolio;
    }

    const migration = await StockPortfolio.updateOne(
      {
        _id: portfolio._id,
        $or: [
          { portfolioType: { $exists: false } },
          { virtualCashMinor: { $exists: true } }
        ]
      },
      {
        $set: { portfolioType: 'bank-funded', holdings: [] },
        $unset: { virtualCashMinor: 1 },
        $inc: { __v: 1 }
      }
    );
    if (migration.modifiedCount === 1) {
      return StockPortfolio.findOne({ userId }).lean();
    }
    return StockPortfolio.findOne({ userId }).lean();
  }

  function serializeTrade(trade) {
    return {
      ticker: trade.ticker,
      side: trade.side,
      shares: trade.shares,
      price: trade.priceMinor / 100,
      total: trade.totalMinor / 100,
      accountNumber: trade.accountNumber || null,
      legacyVirtualTrade: !trade.accountNumber,
      createdAt: trade.createdAt
    };
  }

  function sendError(res, operation, error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    return reportServerError(res, operation, error);
  }

  app.get('/api/stocks', requireCustomer, async (req, res) => {
    try {
      const stocks = await marketClient.getStocks();
      res.status(200).json({
        mode: 'simulated',
        quoteNote: 'Latest JSE quotes from Mansa are in ZAR and may be up to 30 minutes old. Trades are simulated.',
        stocks: stocks.map(({ ticker, name, price, currency, changePercent }) => ({
          ticker, name, price, currency, changePercent
        }))
      });
    } catch (error) {
      sendError(res, 'JSE stock listing', error);
    }
  });

  app.get('/api/investments', requireCustomer, async (req, res) => {
    try {
      const [portfolio, recentTrades, accounts, stocks] = await Promise.all([
        getOrCreatePortfolio(req.authUser._id),
        StockTrade.find({ userId: req.authUser._id })
          .sort({ createdAt: -1, _id: -1 })
          .limit(50)
          .lean(),
        Account.find({ ownerUserId: req.authUser._id, status: 'active' })
          .select('accountNumber accountType balanceMinor')
          .sort({ createdAt: -1 })
          .lean(),
        marketClient.getStocks()
      ]);
      const stocksByTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));
      const positions = await Promise.all(portfolio.holdings.map(async (holding) => {
        let stock = stocksByTicker.get(holding.ticker);
        if (!stock) stock = await marketClient.getStock(holding.ticker);
        const costBasisMinor = holding.averageCostMinor * holding.shares;
        const marketValueMinor = stock ? stock.priceMinor * holding.shares : null;
        if (!Number.isSafeInteger(costBasisMinor) ||
            (marketValueMinor !== null && !Number.isSafeInteger(marketValueMinor))) {
          const error = new Error('Portfolio values exceed the supported precision.');
          error.statusCode = 409;
          throw error;
        }
        return {
          ticker: holding.ticker,
          name: stock?.name || holding.ticker,
          shares: holding.shares,
          averageCost: holding.averageCostMinor / 100,
          price: stock?.price ?? null,
          marketValue: marketValueMinor === null ? null : marketValueMinor / 100,
          gainLoss: marketValueMinor === null ? null : (marketValueMinor - costBasisMinor) / 100
        };
      }));
      const marketValueMinor = positions.reduce((total, position) => {
        return total + Math.round((position.marketValue || 0) * 100);
      }, 0);
      const costBasisMinor = portfolio.holdings.reduce((total, holding) => {
        return total + holding.averageCostMinor * holding.shares;
      }, 0);
      if (!Number.isSafeInteger(marketValueMinor) || !Number.isSafeInteger(costBasisMinor)) {
        const error = new Error('Portfolio values exceed the supported precision.');
        error.statusCode = 409;
        throw error;
      }
      res.status(200).json({
        mode: 'simulated',
        marketValue: marketValueMinor / 100,
        costBasis: costBasisMinor / 100,
        gainLoss: (marketValueMinor - costBasisMinor) / 100,
        positions,
        accounts: accounts.map((account) => ({
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          balance: account.balanceMinor / 100,
          currency: 'ZAR'
        })),
        trades: recentTrades.map(serializeTrade)
      });
    } catch (error) {
      sendError(res, 'Investment portfolio lookup', error);
    }
  });

  app.post('/api/investments/trades', requireCustomer, async (req, res) => {
    const { ticker, side, shares, accountNumber } = req.body || {};
    const idempotencyKey = req.get('Idempotency-Key');
    if (typeof ticker !== 'string' || !/^[A-Z0-9.-]{1,12}$/i.test(ticker)) {
      return res.status(400).json({ error: 'Choose a JSE stock from the live market list.' });
    }
    if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Choose buy or sell.' });
    if (!Number.isSafeInteger(shares) || shares < 1 || shares > 100_000) {
      return res.status(400).json({ error: 'Share quantity must be a whole number from 1 to 100,000.' });
    }
    if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Choose one of your active bank accounts.' });
    }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: 'A valid Idempotency-Key header is required for simulated trades.' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const requestFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ ticker: normalizedTicker, side, shares, accountNumber }))
      .digest('hex');
    const priorTrade = await StockTrade.findOne({ userId: req.authUser._id, idempotencyKey }).lean();
    if (priorTrade) {
      if (priorTrade.requestFingerprint !== requestFingerprint) {
        return res.status(409).json({ error: 'This Idempotency-Key was already used for a different trade.' });
      }
      return res.status(200).json({ trade: serializeTrade(priorTrade), message: 'Simulated trade already processed.' });
    }
    const priorTransaction = await Transaction.findOne({
      actorUserId: req.authUser._id,
      idempotencyKey
    }).lean();
    if (priorTransaction) {
      return res.status(409).json({ error: 'This Idempotency-Key was already used for another transaction.' });
    }

    const selectedAccount = await Account.exists({
      ownerUserId: req.authUser._id,
      accountNumber,
      status: 'active'
    });
    if (!selectedAccount) {
      return res.status(403).json({ error: 'Choose one of your own active bank accounts.' });
    }

    let stock;
    try {
      const listedStocks = await marketClient.getStocks();
      stock = listedStocks.find((listedStock) => listedStock.ticker === normalizedTicker);
      if (!stock) {
        return res.status(400).json({ error: 'Choose a JSE stock from the live market list.' });
      }
    } catch (error) {
      return sendError(res, 'JSE trade quote', error);
    }

    let session;
    let savedTrade;
    try {
      const portfolio = await getOrCreatePortfolio(req.authUser._id);
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const holdings = portfolio.holdings || [];
        const result = calculateHoldingsTrade({
          holdings,
          ticker: normalizedTicker,
          side,
          shares,
          priceMinor: stock.priceMinor
        });
        if (result.error) {
          const error = new Error(result.error);
          error.statusCode = 409;
          throw error;
        }

        const accountBalanceLimit = Number.MAX_SAFE_INTEGER - result.totalMinor;
        const account = await Account.findOneAndUpdate(
          side === 'buy'
            ? {
                ownerUserId: req.authUser._id,
                accountNumber,
                status: 'active',
                balanceMinor: { $gte: result.totalMinor }
              }
            : {
                ownerUserId: req.authUser._id,
                accountNumber,
                status: 'active',
                balanceMinor: { $lte: accountBalanceLimit }
              },
          { $inc: { balanceMinor: side === 'buy' ? -result.totalMinor : result.totalMinor } },
          { new: true, session }
        );
        if (!account) {
          const error = new Error(
            side === 'buy' ? 'Insufficient funds in the selected account.' : 'Account balance limit exceeded.'
          );
          error.statusCode = 409;
          throw error;
        }

        const owner = await User.findById(req.authUser._id).select('accountNumber').session(session).lean();
        if (!owner) throw new Error('The customer account could not be found.');
        if (owner.accountNumber === accountNumber) {
          const balanceDelta = side === 'buy' ? -result.totalMinor : result.totalMinor;
          const balanceUpdate = await User.updateOne(
            { _id: req.authUser._id, accountNumber, balanceMinor: account.balanceMinor - balanceDelta },
            { $inc: { balanceMinor: balanceDelta } },
            { session }
          );
          if (balanceUpdate.matchedCount !== 1) {
            const error = new Error('The primary account balance summary is inconsistent; the trade was not completed.');
            error.statusCode = 409;
            throw error;
          }
        }

        const update = await StockPortfolio.updateOne(
          { _id: portfolio._id, __v: portfolio.__v ?? 0 },
          { $set: { holdings: result.holdings }, $inc: { __v: 1 } },
          { session }
        );
        if (update.modifiedCount !== 1) {
          const error = new Error('Portfolio changed during this trade. Please retry.');
          error.statusCode = 409;
          throw error;
        }

        await Transaction.create([{
          type: side === 'buy' ? 'stock_buy' : 'stock_sell',
          actorUserId: req.authUser._id,
          idempotencyKey,
          requestFingerprint,
          fromAccount: side === 'buy' ? accountNumber : PORTFOLIO_ACCOUNT,
          toAccount: side === 'buy' ? PORTFOLIO_ACCOUNT : accountNumber,
          amountMinor: result.totalMinor,
          description: `Simulated ${side} of ${shares} ${normalizedTicker} shares`
        }], { session });
        [savedTrade] = await StockTrade.create([{
          userId: req.authUser._id,
          accountNumber,
          idempotencyKey,
          requestFingerprint,
          ticker: normalizedTicker,
          side,
          shares,
          priceMinor: stock.priceMinor,
          totalMinor: result.totalMinor
        }], { session });
      });
      res.status(201).json({
        trade: serializeTrade(savedTrade),
        message: `Simulated ${side} completed at the latest available quote. Your selected bank account was ${side === 'buy' ? 'debited' : 'credited'}; no real shares were acquired.`
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (error.code === 11000) {
        const duplicate = await StockTrade.findOne({ userId: req.authUser._id, idempotencyKey }).lean();
        if (duplicate?.requestFingerprint === requestFingerprint) {
          return res.status(200).json({ trade: serializeTrade(duplicate), message: 'Simulated trade already processed.' });
        }
        if (duplicate) return res.status(409).json({ error: 'This Idempotency-Key was already used for a different trade.' });
      }
      if (error.code === 20 || /transaction numbers are only allowed/i.test(String(error?.message || ''))) {
        return res.status(503).json({ error: 'Simulated trading requires MongoDB running as a replica set.' });
      }
      sendError(res, 'Simulated stock trade', error);
    } finally {
      if (session) await session.endSession();
    }
  });
}

module.exports = { registerInvestmentRoutes };
