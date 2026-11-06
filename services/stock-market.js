const MARKET_API_BASE_URL = 'https://mansaapi.com/api/v1/markets/exchanges/JSE';
const STOCKS_CACHE_TTL_MS = 30 * 60 * 1000;

class MarketDataError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'MarketDataError';
    this.statusCode = statusCode;
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeStock(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const quote = record.quote && typeof record.quote === 'object' ? record.quote : {};
  const reference = record.reference && typeof record.reference === 'object' ? record.reference : {};
  const ticker = firstValue(record.ticker, record.symbol, record.code, quote.ticker, reference.ticker);
  const name = firstValue(
    record.name, record.company_name, record.companyName, record.company,
    record.description, reference.name, reference.company_name, reference.company
  );
  const rawPrice = firstValue(
    quote.price, quote.last_price, quote.close,
    record.price, record.last_price, record.close, record.current_price
  );
  const currency = firstValue(record.currency, quote.currency, 'ZAR');
  const price = typeof rawPrice === 'number' || typeof rawPrice === 'string'
    ? Number(rawPrice)
    : NaN;
  if (typeof ticker !== 'string' || !/^[A-Z0-9.-]{1,12}$/i.test(ticker) ||
      typeof name !== 'string' || !Number.isFinite(price) || price <= 0 ||
      currency !== 'ZAR' || firstValue(record.price_unit, quote.price_unit, 'major') !== 'major') {
    return null;
  }
  const priceMinor = Math.round(price * 100);
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 1) return null;
  return {
    ticker: ticker.toUpperCase(),
    name,
    priceMinor,
    price: priceMinor / 100,
    currency: 'ZAR',
    changePercent: firstValue(quote.change_pct, record.change_pct, null)
  };
}

function extractStockList(payload) {
  const data = payload?.data;
  const records = Array.isArray(data)
    ? data
    : firstValue(data?.stocks, data?.results, payload?.stocks, payload?.results);
  if (!Array.isArray(records)) {
    throw new MarketDataError('The market-data provider returned an unsupported stock list.');
  }
  const stocks = records.map(normalizeStock).filter(Boolean);
  if (stocks.length === 0) {
    throw new MarketDataError('The market-data provider returned no usable JSE quotes.');
  }
  return stocks;
}

function extractStock(payload, requestedTicker) {
  const data = payload?.data;
  const record = data?.stock || data;
  const stock = normalizeStock(record);
  if (!stock || stock.ticker !== requestedTicker) {
    throw new MarketDataError('The market-data provider returned an unsupported stock quote.');
  }
  return stock;
}

function createMarketClient({
  fetchImpl = globalThis.fetch,
  getApiKey = () => process.env.MANSA_API_KEY,
  now = Date.now
} = {}) {
  let stockCache;
  let stockCacheExpiresAt = 0;
  let stockRequest;

  async function request(path) {
    const apiKey = getApiKey();
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new MarketDataError('Live JSE quotes are unavailable until MANSA_API_KEY is configured.', 503);
    }

    let response;
    try {
      response = await fetchImpl(`${MARKET_API_BASE_URL}${path}`, {
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey.trim()
        },
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new MarketDataError('The market-data provider could not be reached.');
    }
    if (!response.ok) {
      throw new MarketDataError(
        response.status === 429
          ? 'The market-data provider is rate-limiting requests. Please try again later.'
          : response.status === 401 || response.status === 403
            ? 'The market-data provider rejected its configured credentials.'
            : 'The market-data provider could not return a quote.',
        response.status === 429 ? 503 : 502
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new MarketDataError('The market-data provider returned invalid JSON.');
    }
    if (payload?.success === false) {
      throw new MarketDataError('The market-data provider could not return a quote.');
    }
    return payload;
  }

  return {
    async getStocks() {
      if (stockCache && now() < stockCacheExpiresAt) return stockCache;
      if (stockRequest) return stockRequest;
      stockRequest = (async () => {
        const payload = await request('/stocks?limit=200&sort_by=ticker&order=asc');
        stockCache = extractStockList(payload);
        stockCacheExpiresAt = now() + STOCKS_CACHE_TTL_MS;
        return stockCache;
      })();
      try {
        return await stockRequest;
      } finally {
        stockRequest = null;
      }
    },

    async getStock(ticker) {
      const normalizedTicker = typeof ticker === 'string' ? ticker.toUpperCase() : '';
      if (!/^[A-Z0-9.-]{1,12}$/.test(normalizedTicker)) return null;
      const payload = await request(`/stocks/${encodeURIComponent(normalizedTicker)}`);
      return extractStock(payload, normalizedTicker);
    }
  };
}

function calculateHoldingsTrade({ holdings, ticker, side, shares, priceMinor }) {
  if (!Number.isSafeInteger(shares) || shares < 1 || !Number.isSafeInteger(priceMinor) || priceMinor < 1) {
    return { error: 'Share quantity and price must be positive whole values.' };
  }
  const totalMinor = shares * priceMinor;
  if (!Number.isSafeInteger(totalMinor)) return { error: 'Trade total exceeds the supported amount.' };

  const nextHoldings = holdings.map((holding) => ({ ...holding }));
  const index = nextHoldings.findIndex((holding) => holding.ticker === ticker);
  const existing = index === -1 ? null : nextHoldings[index];

  if (side === 'buy') {
    const newShares = (existing?.shares || 0) + shares;
    if (!Number.isSafeInteger(newShares)) return { error: 'Share quantity exceeds the supported amount.' };
    const existingCostMinor = (existing?.shares || 0) * (existing?.averageCostMinor || 0);
    const combinedCostMinor = existingCostMinor + totalMinor;
    if (!Number.isSafeInteger(existingCostMinor) || !Number.isSafeInteger(combinedCostMinor)) {
      return { error: 'Portfolio cost basis exceeds the supported amount.' };
    }
    const averageCostMinor = Math.round(
      combinedCostMinor / newShares
    );
    const updatedHolding = { ticker, shares: newShares, averageCostMinor };
    if (index === -1) nextHoldings.push(updatedHolding);
    else nextHoldings[index] = updatedHolding;
    return { holdings: nextHoldings, totalMinor };
  }

  if (side !== 'sell') return { error: 'Choose buy or sell.' };
  if (!existing || existing.shares < shares) return { error: 'You do not own enough shares to sell.' };
  if (existing.shares === shares) nextHoldings.splice(index, 1);
  else nextHoldings[index] = { ...existing, shares: existing.shares - shares };
  return { holdings: nextHoldings, totalMinor };
}

const defaultMarketClient = createMarketClient();

module.exports = {
  MarketDataError,
  calculateHoldingsTrade,
  createMarketClient,
  defaultMarketClient,
  extractStock,
  extractStockList
};
