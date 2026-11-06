function parseAmountMinor(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function transactionResponse(transaction) {
  return {
    id: String(transaction._id),
    type: transaction.type,
    fromAccount: transaction.fromAccount,
    toAccount: transaction.toAccount,
    amount: transaction.amountMinor / 100,
    currency: 'ZAR',
    description: transaction.description,
    createdAt: transaction.createdAt
  };
}

function parseDateFilter(value, endOfDay = false) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  if (endOfDay) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function buildTransactionFilter(query, user, allowedAccountNumbers = [user.accountNumber].filter(Boolean)) {
  const clauses = [];
  if ((query.from !== undefined && query.from !== '' && typeof query.from !== 'string') ||
      (query.to !== undefined && query.to !== '' && typeof query.to !== 'string') ||
      (query.type !== undefined && query.type !== '' && typeof query.type !== 'string') ||
      (query.accountNumber !== undefined && query.accountNumber !== '' && typeof query.accountNumber !== 'string')) {
    return { error: { status: 400, message: 'Transaction filters must be single values.' } };
  }
  const from = query.from === undefined || query.from === '' ? null : parseDateFilter(query.from);
  const to = query.to === undefined || query.to === '' ? null : parseDateFilter(query.to, true);

  if ((query.from && !from) || (query.to && !to)) {
    return { error: { status: 400, message: 'Dates must be valid and use YYYY-MM-DD format.' } };
  }
  if (from && to && from > to) {
    return { error: { status: 400, message: 'The start date must be on or before the end date.' } };
  }
  if (query.type && !['transfer', 'deposit', 'withdrawal', 'interest'].includes(query.type)) {
    return { error: { status: 400, message: 'Transaction type filter is invalid.' } };
  }
  if (query.accountNumber && !/^\d{10}$/.test(query.accountNumber)) {
    return { error: { status: 400, message: 'Account number filter must be exactly 10 digits.' } };
  }
  if (query.accountNumber && user.role !== 'admin' && !allowedAccountNumbers.includes(query.accountNumber)) {
    return { error: { status: 403, message: 'You do not have access to this account.' } };
  }

  if (user.role !== 'admin') {
    const accounts = allowedAccountNumbers.length === 1
      ? allowedAccountNumbers[0]
      : { $in: allowedAccountNumbers };
    clauses.push({
      $or: [{ fromAccount: accounts }, { toAccount: accounts }]
    });
  }
  if (query.accountNumber) {
    clauses.push({
      $or: [{ fromAccount: query.accountNumber }, { toAccount: query.accountNumber }]
    });
  }
  if (query.type) clauses.push({ type: query.type });
  if (from || to) {
    const createdAt = {};
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    clauses.push({ createdAt });
  }

  return { filter: clauses.length ? { $and: clauses } : {} };
}

function parseTransactionPagination(query) {
  const pageText = query.page === undefined ? '1' : query.page;
  const limitText = query.limit === undefined ? '25' : query.limit;
  if (typeof pageText !== 'string' || !/^[1-9]\d{0,3}$/.test(pageText) ||
      Number(pageText) > 1000 || typeof limitText !== 'string' ||
      !/^(?:[1-9]\d?|100)$/.test(limitText)) {
    return { error: { status: 400, message: 'Page must be between 1 and 1,000, and page size between 1 and 100.' } };
  }
  return { page: Number(pageText), limit: Number(limitText) };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function transactionCsv(transactions) {
  const rows = [
    ['Created At (UTC)', 'Type', 'From Account', 'To Account', 'Amount (ZAR)', 'Description'],
    ...transactions.map((transaction) => [
      transaction.createdAt.toISOString(),
      transaction.type,
      transaction.fromAccount || '',
      transaction.toAccount || '',
      (transaction.amountMinor / 100).toFixed(2),
      transaction.description
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = {
  parseAmountMinor,
  transactionResponse,
  buildTransactionFilter,
  parseTransactionPagination,
  transactionCsv
};
