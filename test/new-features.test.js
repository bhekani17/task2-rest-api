const test = require('node:test');
const assert = require('node:assert/strict');
const { detectProfilePhotoType } = require('../lib/profile-photo');
const {
  calculateHoldingsTrade, createMarketClient, extractStock, extractStockList
} = require('../services/stock-market');
const { registerInvestmentRoutes } = require('../routes/investments');
const { registerBankingFeatureRoutes, advanceScheduleDate } = require('../routes/banking-features');
const { parseAmountMinor, transactionResponse } = require('../services/transaction-service');

const stock = {
  ticker: 'FSR',
  name: 'FirstRand Limited',
  priceMinor: 7_300,
  price: 73,
  currency: 'ZAR'
};

function fakeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function callRoute(handlers, req) {
  const res = fakeResponse();
  let responsePromise;
  await handlers[0](req, res, () => {
    responsePromise = handlers[1](req, res);
  });
  if (responsePromise) await responsePromise;
  return res;
}

test('profile photo detection accepts only supported image signatures', () => {
  assert.equal(detectProfilePhotoType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(
    detectProfilePhotoType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  );
  assert.equal(detectProfilePhotoType(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(detectProfilePhotoType(Buffer.from('<svg></svg>')), null);
});

test('Mansa stock responses normalize live quotes expressed in ZAR', () => {
  const payload = {
    success: true,
    data: {
      stocks: [{
        ticker: 'fsr',
        name: 'FirstRand Limited',
        price: 73.123,
        currency: 'ZAR',
        change_pct: 1.4
      }]
    }
  };
  assert.deepEqual(extractStockList(payload), [{
    ticker: 'FSR',
    name: 'FirstRand Limited',
    priceMinor: 7_312,
    price: 73.12,
    currency: 'ZAR',
    changePercent: 1.4
  }]);
  assert.equal(extractStock({ success: true, data: payload.data.stocks[0] }, 'FSR').priceMinor, 7_312);
  assert.equal(extractStock({
    success: true,
    data: {
      ticker: 'FSR',
      quote: { price: 74, currency: 'ZAR' },
      reference: { name: 'FirstRand Limited' }
    }
  }, 'FSR').priceMinor, 7_400);
  assert.throws(() => extractStockList({ data: [{ ticker: 'FSR', name: 'FirstRand', price: 73, currency: 'USD' }] }));
});

test('Mansa market client caches successful listings and never hides missing credentials', async () => {
  let now = 1000;
  let calls = 0;
  const client = createMarketClient({
    getApiKey: () => 'test-only-key',
    now: () => now,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(url, /\/stocks\?limit=200/);
      assert.equal(options.headers['X-API-Key'], 'test-only-key');
      return {
        ok: true,
        json: async () => ({ success: true, data: { stocks: [stock] } })
      };
    }
  });
  await Promise.all([client.getStocks(), client.getStocks()]);
  assert.equal(calls, 1);
  now += 30 * 60 * 1000 + 1;
  await client.getStocks();
  assert.equal(calls, 2);

  let attemptedFetch = false;
  const unconfigured = createMarketClient({
    getApiKey: () => '',
    fetchImpl: async () => { attemptedFetch = true; }
  });
  await assert.rejects(unconfigured.getStocks(), { statusCode: 503 });
  assert.equal(attemptedFetch, false);
});

test('simulated holdings track purchases and prevent selling shares not owned', () => {
  const bought = calculateHoldingsTrade({
    holdings: [],
    ticker: stock.ticker,
    side: 'buy',
    shares: 10,
    priceMinor: stock.priceMinor
  });
  assert.equal(bought.error, undefined);
  assert.equal(bought.totalMinor, 73_000);
  assert.deepEqual(bought.holdings, [{
    ticker: 'FSR',
    shares: 10,
    averageCostMinor: stock.priceMinor
  }]);

  const sold = calculateHoldingsTrade({
    holdings: bought.holdings,
    ticker: stock.ticker,
    side: 'sell',
    shares: 4,
    priceMinor: stock.priceMinor
  });
  assert.equal(sold.totalMinor, 29_200);
  assert.equal(sold.holdings[0].shares, 6);
  assert.equal(calculateHoldingsTrade({
    holdings: sold.holdings,
    ticker: stock.ticker,
    side: 'sell',
    shares: 7,
    priceMinor: stock.priceMinor
  }).error, 'You do not own enough shares to sell.');
});

test('administrator sessions cannot access or trade the customer investing simulator', async () => {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); }
  };
  registerInvestmentRoutes(app, {});

  for (const route of ['GET /api/stocks', 'GET /api/investments', 'POST /api/investments/trades']) {
    const res = await callRoute(routes.get(route), {
      authUser: { role: 'admin' },
      body: {},
      get: () => ''
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Simulated investing is available to customer accounts only.');
  }
});

test('live quote failures are explicit and a customer cannot trade from another account', async () => {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); }
  };
  let quoteRequests = 0;
  const nullQuery = () => ({ lean: async () => null });
  registerInvestmentRoutes(app, {
    StockTrade: { findOne: nullQuery },
    Transaction: { findOne: nullQuery },
    Account: { exists: async () => false },
    reportServerError: (res) => res.status(500).json({ error: 'Unexpected error.' }),
    marketClient: {
      getStocks: async () => {
        quoteRequests += 1;
        const error = new Error('MANSA_API_KEY is not configured.');
        error.statusCode = 503;
        throw error;
      }
    }
  });

  const stockResponse = await callRoute(routes.get('GET /api/stocks'), {
    authUser: { role: 'customer' }
  });
  assert.equal(stockResponse.statusCode, 503);
  assert.match(stockResponse.body.error, /MANSA_API_KEY/);

  const tradeResponse = await callRoute(routes.get('POST /api/investments/trades'), {
    authUser: { role: 'customer', _id: 'customer-id' },
    body: {
      ticker: stock.ticker,
      side: 'buy',
      shares: 1,
      accountNumber: '9999999999'
    },
    get: () => 'trade-key-00000001'
  });
  assert.equal(tradeResponse.statusCode, 403);
  assert.match(tradeResponse.body.error, /own active bank accounts/);
  assert.equal(quoteRequests, 1);
});

test('legacy virtual holdings are cleared before they can be sold for bank funds', async () => {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); }
  };
  const userId = 'customer-id';
  const portfolio = {
    _id: 'legacy-portfolio',
    __v: 0,
    userId,
    virtualCashMinor: 10_000_000,
    holdings: [{ ticker: stock.ticker, shares: 10, averageCostMinor: stock.priceMinor }]
  };
  const query = (value) => ({
    lean: async () => structuredClone(value)
  });
  let bankBalanceChanges = 0;
  const StockPortfolio = {
    findOneAndUpdate: () => query(portfolio),
    updateOne: (filter, update) => {
      if (!filter.$or) return { modifiedCount: 0 };
      portfolio.portfolioType = update.$set.portfolioType;
      portfolio.holdings = update.$set.holdings;
      delete portfolio.virtualCashMinor;
      portfolio.__v += update.$inc.__v;
      return { modifiedCount: 1 };
    },
    findOne: () => query(portfolio)
  };
  registerInvestmentRoutes(app, {
    StockPortfolio,
    StockTrade: { findOne: () => query(null) },
    Transaction: { findOne: () => query(null) },
    Account: {
      exists: async () => true,
      findOneAndUpdate: async () => { bankBalanceChanges += 1; }
    },
    mongoose: {
      startSession: async () => ({
        withTransaction: async (operation) => operation(),
        endSession: async () => {}
      })
    },
    reportServerError: (res) => res.status(500).json({ error: 'Unexpected error.' }),
    marketClient: {
      getStocks: async () => [stock],
      getStock: async () => stock
    }
  });

  const response = await callRoute(routes.get('POST /api/investments/trades'), {
    authUser: { role: 'customer', _id: userId },
    body: {
      ticker: stock.ticker,
      side: 'sell',
      shares: 1,
      accountNumber: '1234567890'
    },
    get: () => 'legacy-sale-key-0001'
  });
  assert.equal(response.statusCode, 409);
  assert.equal(portfolio.portfolioType, 'bank-funded');
  assert.equal(portfolio.virtualCashMinor, undefined);
  assert.deepEqual(portfolio.holdings, []);
  assert.equal(bankBalanceChanges, 0);
});

test('bank-funded simulated trades update balances and both ledgers once per idempotency key', async () => {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); }
  };
  const accountNumber = '1234567890';
  const userId = 'customer-id';
  const portfolio = {
    _id: 'portfolio-id',
    __v: 0,
    userId,
    portfolioType: 'bank-funded',
    holdings: []
  };
  const trades = [];
  const transactions = [];
  const bankAccount = { ownerUserId: userId, accountNumber, status: 'active', balanceMinor: 1_000_000 };
  const clone = (value) => value && structuredClone(value);
  const query = (value) => ({
    select() { return this; },
    session() { return this; },
    lean: async () => clone(value)
  });
  const StockPortfolio = {
    findOneAndUpdate: () => ({ lean: async () => clone(portfolio) }),
    updateOne: (filter, update) => {
      if (filter.__v !== portfolio.__v) return { modifiedCount: 0 };
      portfolio.holdings = clone(update.$set.holdings);
      portfolio.__v += update.$inc.__v;
      return { modifiedCount: 1 };
    }
  };
  const StockTrade = {
    findOne: ({ idempotencyKey }) => query(trades.find((trade) => trade.idempotencyKey === idempotencyKey) || null),
    create: async ([trade]) => {
      const saved = { ...clone(trade), _id: `trade-${trades.length + 1}`, createdAt: new Date() };
      trades.push(saved);
      return [saved];
    }
  };
  const Transaction = {
    findOne: ({ idempotencyKey }) => query(transactions.find((entry) => entry.idempotencyKey === idempotencyKey) || null),
    create: async ([transaction]) => {
      const saved = { ...clone(transaction), _id: `transaction-${transactions.length + 1}` };
      transactions.push(saved);
      return [saved];
    }
  };
  const Account = {
    exists: async () => true,
    findOneAndUpdate: (filter, update) => {
      const minimum = filter.balanceMinor?.$gte;
      const maximum = filter.balanceMinor?.$lte;
      if ((minimum !== undefined && bankAccount.balanceMinor < minimum) ||
          (maximum !== undefined && bankAccount.balanceMinor > maximum)) return null;
      bankAccount.balanceMinor += update.$inc.balanceMinor;
      return clone(bankAccount);
    }
  };
  const User = {
    findById: () => query({ accountNumber }),
    updateOne: async () => ({ matchedCount: 1 })
  };
  const mongoose = {
    startSession: async () => ({
      withTransaction: async (operation) => operation(),
      endSession: async () => {}
    })
  };
  registerInvestmentRoutes(app, {
    User,
    Account,
    Transaction,
    StockPortfolio,
    StockTrade,
    mongoose,
    reportServerError: (res) => res.status(500).json({ error: 'Unexpected error.' }),
    marketClient: {
      getStocks: async () => [stock],
      getStock: async () => stock
    }
  });

  async function submit(side, shares, key) {
    return callRoute(routes.get('POST /api/investments/trades'), {
      authUser: { role: 'customer', _id: userId },
      body: { ticker: stock.ticker, side, shares, accountNumber },
      get: () => key
    });
  }

  const buy = await submit('buy', 2, 'buy-trade-key-00001');
  assert.equal(buy.statusCode, 201);
  assert.equal(bankAccount.balanceMinor, 985_400);
  assert.equal(portfolio.holdings[0].shares, 2);
  assert.equal(transactions[0].type, 'stock_buy');
  assert.equal(transactions[0].amountMinor, 14_600);

  const replay = await submit('buy', 2, 'buy-trade-key-00001');
  assert.equal(replay.statusCode, 200);
  assert.equal(bankAccount.balanceMinor, 985_400);
  assert.equal(transactions.length, 1);

  const sell = await submit('sell', 1, 'sell-trade-key-00001');
  assert.equal(sell.statusCode, 201);
  assert.equal(bankAccount.balanceMinor, 992_700);
  assert.equal(portfolio.holdings[0].shares, 1);
  assert.equal(transactions[1].type, 'stock_sell');
  assert.equal(transactions[1].toAccount, accountNumber);

  const insufficient = await submit('buy', 1000, 'buy-trade-key-00002');
  assert.equal(insufficient.statusCode, 409);
  assert.match(insufficient.body.error, /Insufficient funds/);
  assert.equal(bankAccount.balanceMinor, 992_700);
});

test('banking features: beneficiaries, virtual cards, savings goals, payment requests, disputes, freeze, and notifications', async () => {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
    patch(path, ...handlers) { routes.set(`PATCH ${path}`, handlers); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers); }
  };

  const accounts = new Map([
    ['1000000001', { ownerUserId: 'user-1', accountNumber: '1000000001', accountType: 'cheque', status: 'active', balanceMinor: 500_000 }],
    ['1000000002', { ownerUserId: 'user-2', accountNumber: '1000000002', accountType: 'savings', status: 'active', balanceMinor: 200_000 }]
  ]);
  const beneficiaries = [];
  const cards = [];
  const goals = [];
  const paymentRequests = [];
  const disputes = [];
  const notifications = [];
  const transactions = [];

  const Account = {
    exists: async ({ accountNumber, ownerUserId, status }) => {
      const acc = accounts.get(accountNumber);
      if (!acc) return false;
      if (ownerUserId && acc.ownerUserId !== ownerUserId) return false;
      if (status && acc.status !== status) return false;
      return true;
    },
    findOne: ({ accountNumber }) => ({
      populate: () => ({
        lean: async () => {
          const acc = accounts.get(accountNumber);
          return acc ? { ...acc, ownerUserId: { _id: acc.ownerUserId, name: acc.ownerUserId === 'user-2' ? 'Grace Hopper' : 'Ada Lovelace' } } : null;
        }
      }),
      lean: async () => accounts.get(accountNumber) || null
    }),
    find: ({ ownerUserId }) => ({
      select: () => ({
        lean: async () => [...accounts.values()].filter((a) => a.ownerUserId === ownerUserId)
      })
    }),
    findOneAndUpdate: (filter, update) => {
      const acc = accounts.get(filter.accountNumber);
      if (!acc) return null;
      if (filter.balanceMinor?.$gte !== undefined && acc.balanceMinor < filter.balanceMinor.$gte) return null;
      if (update.$inc?.balanceMinor) acc.balanceMinor += update.$inc.balanceMinor;
      if (update.$set?.status) acc.status = update.$set.status;
      return { ...acc };
    }
  };

  registerBankingFeatureRoutes(app, {
    requireAdmin: (req, res, next) => (req.authUser?.role === 'admin' ? next() : res.status(403).json({ error: 'Forbidden' })),
    User: { updateOne: async () => ({ matchedCount: 1 }) },
    Account,
    Transaction: {
      findById: (id) => ({
        session: async () => transactions.find((t) => String(t._id) === String(id)) || null,
        lean: async () => transactions.find((t) => String(t._id) === String(id)) || null
      }),
      create: async ([tx]) => {
        const nextHex = String(90 + transactions.length).padStart(2, '0');
        const saved = { _id: `65f0000000000000000000${nextHex}`, createdAt: new Date(), ...tx };
        transactions.push(saved);
        return [saved];
      }
    },
    Beneficiary: {
      find: () => ({ sort: () => ({ lean: async () => beneficiaries }) }),
      create: async (doc) => {
        const saved = { _id: '65f000000000000000000001', createdAt: new Date(), ...doc };
        beneficiaries.push(saved);
        return saved;
      },
      deleteOne: async () => ({ deletedCount: 1 })
    },
    ScheduledTransfer: {},
    PaymentRequest: {
      create: async (doc) => {
        const saved = { _id: '65f000000000000000000002', createdAt: new Date(), ...doc };
        paymentRequests.push(saved);
        return saved;
      },
      findById: (id) => ({ lean: async () => paymentRequests.find((r) => String(r._id) === String(id)) || null }),
      findOneAndUpdate: () => paymentRequests[0],
      updateOne: async () => ({ modifiedCount: 1 })
    },
    VirtualCard: {
      countDocuments: async () => cards.length,
      create: async (doc) => {
        const saved = { _id: '65f000000000000000000003', createdAt: new Date(), ...doc };
        cards.push(saved);
        return saved;
      },
      findOneAndUpdate: async (_filter, update) => {
        Object.assign(cards[0], update.$set);
        return cards[0];
      }
    },
    SavingsGoal: {
      create: async (doc) => {
        const saved = { _id: '65f000000000000000000004', createdAt: new Date(), ...doc };
        goals.push(saved);
        return saved;
      },
      findOne: () => ({ session: async () => goals[0] || null }),
      findOneAndUpdate: async (_filter, update) => {
        if (update.$inc?.currentMinor) goals[0].currentMinor += update.$inc.currentMinor;
        if (update.$set?.status) goals[0].status = update.$set.status;
        return goals[0];
      }
    },
    Dispute: {
      findOne: ({ _id }) => ({
        lean: async () => null,
        session: async () => disputes.find((d) => String(d._id) === String(_id)) || null
      }),
      create: async (doc) => {
        const saved = { _id: '65f000000000000000000005', createdAt: new Date(), ...doc };
        disputes.push(saved);
        return saved;
      },
      findOneAndUpdate: async (_filter, update) => {
        Object.assign(disputes[0], update.$set);
        return disputes[0];
      }
    },
    AuditLog: { create: async () => {} },
    Notification: {
      create: async (doc) => { notifications.push({ _id: 'notif-1', createdAt: new Date(), ...doc }); },
      find: () => ({ sort: () => ({ limit: () => ({ lean: async () => notifications }) }) }),
      countDocuments: async () => notifications.filter((n) => !n.read).length,
      updateMany: async () => { for (const n of notifications) n.read = true; }
    },
    mongoose: {
      startSession: async () => ({
        withTransaction: async (fn) => fn(),
        endSession: async () => {}
      })
    },
    io: { to: () => ({ emit: () => {} }) },
    SYSTEM_ACTOR_USER_ID: 'system',
    parseAmountMinor,
    transactionResponse,
    reportServerError: (res, _ctx, err) => res.status(500).json({ error: err.message })
  });

  // 1. Account lookup & beneficiary creation
  const lookupRes = await callRoute(routes.get('GET /api/accounts/lookup/:accountNumber'), {
    authUser: { _id: 'user-1', role: 'customer' },
    params: { accountNumber: '1000000002' }
  });
  assert.equal(lookupRes.statusCode, 200);
  assert.equal(lookupRes.body.holderName, 'Grace Hopper');

  const benRes = await callRoute(routes.get('POST /api/beneficiaries'), {
    authUser: { _id: 'user-1', role: 'customer' },
    body: { accountNumber: '1000000002', nickname: 'Grace', defaultReference: 'Rent' }
  });
  assert.equal(benRes.statusCode, 201);
  assert.equal(benRes.body.beneficiary.name, 'Grace Hopper');

  // 2. Virtual card issue & freeze
  const cardRes = await callRoute(routes.get('POST /api/cards'), {
    authUser: { _id: 'user-1', name: 'Ada Lovelace', role: 'customer' },
    body: { accountNumber: '1000000001', dailyLimit: '15000' }
  });
  assert.equal(cardRes.statusCode, 201);
  assert.equal(cardRes.body.card.dailyLimit, 15000);

  const freezeCardRes = await callRoute(routes.get('PATCH /api/cards/:id'), {
    authUser: { _id: 'user-1', role: 'customer' },
    params: { id: '65f000000000000000000003' },
    body: { status: 'frozen', onlinePaymentsEnabled: false }
  });
  assert.equal(freezeCardRes.statusCode, 200);
  assert.equal(freezeCardRes.body.card.status, 'frozen');
  assert.equal(freezeCardRes.body.card.onlinePaymentsEnabled, false);

  // 3. Savings goal create & allocate
  const goalRes = await callRoute(routes.get('POST /api/savings-goals'), {
    authUser: { _id: 'user-1', role: 'customer' },
    body: { accountNumber: '1000000001', name: 'Holiday', targetAmount: '1000' }
  });
  assert.equal(goalRes.statusCode, 201);

  const allocRes = await callRoute(routes.get('POST /api/savings-goals/:id/allocate'), {
    authUser: { _id: 'user-1', role: 'customer' },
    params: { id: '65f000000000000000000004' },
    body: { direction: 'deposit', amount: '250' }
  });
  assert.equal(allocRes.statusCode, 200);
  assert.equal(allocRes.body.goal.currentAmount, 250);
  assert.equal(accounts.get('1000000001').balanceMinor, 475_000);

  // 4. Payment request & approval
  const reqRes = await callRoute(routes.get('POST /api/payment-requests'), {
    authUser: { _id: 'user-2', name: 'Grace Hopper', role: 'customer' },
    body: {
      receivingAccountNumber: '1000000002',
      payerAccountNumber: '1000000001',
      amount: '100.00',
      description: 'Lunch'
    }
  });
  assert.equal(reqRes.statusCode, 201);

  const payRes = await callRoute(routes.get('POST /api/payment-requests/:id/respond'), {
    authUser: { _id: 'user-1', name: 'Ada Lovelace', role: 'customer' },
    params: { id: '65f000000000000000000002' },
    body: { action: 'pay' }
  });
  assert.equal(payRes.statusCode, 200);
  assert.equal(accounts.get('1000000001').balanceMinor, 465_000);
  assert.equal(accounts.get('1000000002').balanceMinor, 210_000);

  // 5. Dispute submission & admin atomic reversal
  const latestTransferTx = transactions.find((t) => t.type === 'transfer');
  const disputeRes = await callRoute(routes.get('POST /api/disputes'), {
    authUser: { _id: 'user-1', role: 'customer' },
    body: { transactionId: String(latestTransferTx._id), reason: 'Duplicate payment sent in error' }
  });
  assert.equal(disputeRes.statusCode, 201);

  const resolveRes = await callRoute(routes.get('PATCH /api/admin/disputes/:id'), {
    authUser: { _id: 'admin-1', role: 'admin' },
    params: { id: '65f000000000000000000005' },
    body: { status: 'resolved', resolutionNote: 'Reversed', reverseTransaction: true }
  });
  assert.equal(resolveRes.statusCode, 200);
  assert.equal(resolveRes.body.dispute.reversed, true);
  assert.equal(accounts.get('1000000001').balanceMinor, 475_000);
  assert.equal(accounts.get('1000000002').balanceMinor, 200_000);

  // 6. Admin account freeze
  const freezeAccRes = await callRoute(routes.get('PATCH /api/admin/accounts/:accountNumber/status'), {
    authUser: { _id: 'admin-1', role: 'admin' },
    params: { accountNumber: '1000000001' },
    body: { status: 'frozen' }
  });
  assert.equal(freezeAccRes.statusCode, 200);
  assert.equal(accounts.get('1000000001').status, 'frozen');

  // 7. Schedule date advancement helper
  const weekly = advanceScheduleDate(new Date('2026-11-01T08:00:00.000Z'), 'weekly');
  assert.equal(weekly.toISOString().slice(0, 10), '2026-11-08');
});
