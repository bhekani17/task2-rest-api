const statusMessage = document.querySelector('#investmentStatus');
const stockTable = document.querySelector('#stockTable');
const tradeHistory = document.querySelector('#tradeHistory');
const tradeAccount = document.querySelector('#tradeAccount');
const tradeKeys = new Map();
const money = (value) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value);

function cell(row, value) {
    const element = document.createElement('td');
    element.textContent = value;
    row.append(element);
    return element;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json();
    if (response.status === 401) {
        window.location.replace('/login');
        throw new Error('Sign in to continue.');
    }
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
}

function renderAccounts(accounts) {
    const previousSelection = tradeAccount.value;
    tradeAccount.replaceChildren();
    if (!accounts.length) {
        tradeAccount.add(new Option('No active accounts available', ''));
        tradeAccount.disabled = true;
        return;
    }
    tradeAccount.add(new Option('Select an account', ''));
    for (const account of accounts) {
        tradeAccount.add(new Option(
            `${account.accountType} · ${account.accountNumber} · ${money(account.balance)}`,
            account.accountNumber
        ));
    }
    tradeAccount.disabled = false;
    if (accounts.some((account) => account.accountNumber === previousSelection)) {
        tradeAccount.value = previousSelection;
    } else {
        tradeAccount.value = accounts[0].accountNumber;
    }
}

function renderStocks(stocks, positions) {
    const positionByTicker = new Map(positions.map((position) => [position.ticker, position]));
    stockTable.replaceChildren();
    if (!stocks.length) {
        const row = document.createElement('tr');
        const empty = cell(row, 'No JSE stock quotes are currently available.');
        empty.colSpan = 5;
        stockTable.append(row);
        return;
    }
    for (const stock of stocks) {
        const position = positionByTicker.get(stock.ticker);
        const row = document.createElement('tr');
        cell(row, stock.ticker);
        cell(row, stock.name);
        cell(row, money(stock.price));
        cell(row, position
            ? position.marketValue === null
                ? `${position.shares} · quote unavailable`
                : `${position.shares} · ${money(position.marketValue)}`
            : '—');
        const actions = document.createElement('td');
        actions.className = 'stock-actions';
        const quantity = document.createElement('input');
        quantity.type = 'number';
        quantity.min = '1';
        quantity.max = '100000';
        quantity.step = '1';
        quantity.value = '1';
        quantity.setAttribute('aria-label', `Shares of ${stock.ticker}`);
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'primary-btn';
        buy.textContent = 'Buy';
        buy.disabled = tradeAccount.disabled || !tradeAccount.value;
        buy.dataset.side = 'buy';
        buy.dataset.ticker = stock.ticker;
        const sell = document.createElement('button');
        sell.type = 'button';
        sell.className = 'secondary-btn';
        sell.textContent = 'Sell';
        sell.disabled = !position || tradeAccount.disabled || !tradeAccount.value;
        sell.dataset.side = 'sell';
        sell.dataset.ticker = stock.ticker;
        actions.append(quantity, buy, sell);
        row.append(actions);
        stockTable.append(row);
    }
}

function renderTrades(trades) {
    tradeHistory.replaceChildren();
    if (!trades.length) {
        const row = document.createElement('tr');
        const empty = cell(row, 'No simulated trades yet.');
        empty.colSpan = 7;
        tradeHistory.append(row);
        return;
    }
    for (const trade of trades) {
        const row = document.createElement('tr');
        cell(row, new Date(trade.createdAt).toLocaleString());
        cell(row, trade.legacyVirtualTrade ? `${trade.side} · prior virtual-cash trade` : trade.side);
        cell(row, trade.ticker);
        cell(row, String(trade.shares));
        cell(row, money(trade.price));
        cell(row, money(trade.total));
        cell(row, trade.accountNumber || 'No bank account (legacy virtual-cash trade)');
        tradeHistory.append(row);
    }
}

async function loadPortfolio() {
    statusMessage.textContent = 'Loading investment portfolio...';
    try {
        const [catalog, portfolio] = await Promise.all([
            requestJson('/api/stocks'),
            requestJson('/api/investments')
        ]);
        document.querySelector('#quoteNote').textContent = catalog.quoteNote;
        document.querySelector('#marketValue').textContent = money(portfolio.marketValue);
        document.querySelector('#costBasis').textContent = money(portfolio.costBasis);
        document.querySelector('#portfolioGainLoss').textContent = money(portfolio.gainLoss);
        renderAccounts(portfolio.accounts);
        renderStocks(catalog.stocks, portfolio.positions);
        renderTrades(portfolio.trades);
        statusMessage.textContent = 'Latest available quotes loaded. Shares and trades are simulated; completed trades affect the selected bank account.';
    } catch (error) {
        statusMessage.textContent = error.message;
    }
}

tradeAccount.addEventListener('change', () => loadPortfolio());

stockTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-side]');
    if (!button) return;
    const quantityInput = button.closest('tr').querySelector('input');
    const shares = Number(quantityInput.value);
    if (!Number.isSafeInteger(shares) || shares < 1 || shares > 100000) {
        statusMessage.textContent = 'Share quantity must be a whole number from 1 to 100,000.';
        return;
    }
    if (!tradeAccount.value) {
        statusMessage.textContent = 'Choose an active bank account before trading.';
        return;
    }
    button.disabled = true;
    statusMessage.textContent = `Processing simulated ${button.dataset.side}...`;
    const payload = {
        ticker: button.dataset.ticker,
        side: button.dataset.side,
        shares,
        accountNumber: tradeAccount.value
    };
    const signature = JSON.stringify(payload);
    if (!tradeKeys.has(signature)) tradeKeys.set(signature, crypto.randomUUID().replaceAll('-', ''));
    try {
        const result = await requestJson('/api/investments/trades', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': tradeKeys.get(signature)
            },
            body: signature
        });
        tradeKeys.delete(signature);
        statusMessage.textContent = result.message;
        await loadPortfolio();
    } catch (error) {
        statusMessage.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

const themeToggle = document.querySelector('#themeToggle');
function applyTheme() {
    const isDark = localStorage.getItem('theme') === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    if (themeToggle) themeToggle.textContent = isDark ? 'Light' : 'Dark';
}
themeToggle?.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
    localStorage.setItem('theme', nextTheme);
    applyTheme();
});
applyTheme();
document.querySelector('#logoutButton').addEventListener('click', async () => {
    try {
        await requestJson('/api/auth/logout', { method: 'POST' });
        window.location.replace('/login');
    } catch (error) {
        statusMessage.textContent = error.message;
    }
});

loadPortfolio();
