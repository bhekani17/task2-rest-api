const test = require('node:test');
const assert = require('node:assert/strict');
const { detectProfilePhotoType } = require('../lib/profile-photo');
const {
  calculateHoldingsTrade, createMarketClient, extractStock, extractStockList
} = require('../services/stock-market');
const { registerInvestmentRoutes } = require('../routes/investments');

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
