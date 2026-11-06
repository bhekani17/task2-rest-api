const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTransactionFilter,
  parseTransactionPagination,
  transactionCsv
} = require('../server');

test('transaction filters validate dates and constrain customers to their own account', () => {
  const customer = { role: 'customer', accountNumber: '1000000001' };
  const result = buildTransactionFilter({
    from: '2026-03-01',
    to: '2026-03-31',
    type: 'transfer',
    accountNumber: '1000000001'
  }, customer);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.filter.$and[0], {
    $or: [{ fromAccount: '1000000001' }, { toAccount: '1000000001' }]
  });
  assert.deepEqual(result.filter.$and[1], {
    $or: [{ fromAccount: '1000000001' }, { toAccount: '1000000001' }]
  });
  assert.equal(result.filter.$and[2].type, 'transfer');
  assert.equal(result.filter.$and[3].createdAt.$gte.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(result.filter.$and[3].createdAt.$lte.toISOString(), '2026-03-31T23:59:59.999Z');

  assert.equal(buildTransactionFilter({ accountNumber: '1000000002' }, customer).error.status, 403);
  assert.equal(buildTransactionFilter({ from: '2026-02-30' }, customer).error.status, 400);
  assert.equal(buildTransactionFilter({ from: '2026-04-01', to: '2026-03-01' }, customer).error.status, 400);
  assert.equal(buildTransactionFilter({ type: 'unknown' }, customer).error.status, 400);
  assert.equal(buildTransactionFilter({ type: 'stock_buy' }, customer).filter.$and[1].type, 'stock_buy');
  assert.equal(buildTransactionFilter({ type: 'stock_sell' }, customer).filter.$and[1].type, 'stock_sell');
  assert.equal(buildTransactionFilter({ accountNumber: ['1000000001'] }, customer).error.status, 400);
});

test('administrators may filter by account and CSV statements escape formula-like descriptions', () => {
  const adminFilter = buildTransactionFilter({
    accountNumber: '1000000002',
    type: 'transfer'
  }, { role: 'admin' });
  assert.equal(adminFilter.error, undefined);
  assert.deepEqual(adminFilter.filter.$and[0], {
    $or: [{ fromAccount: '1000000002' }, { toAccount: '1000000002' }]
  });

  const csv = transactionCsv([{
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    type: 'transfer',
    fromAccount: '1000000001',
    toAccount: '1000000002',
    amountMinor: 12345,
    description: '=HYPERLINK("example")'
  }]);
  assert.match(csv, /"Amount \(ZAR\)"/);
  assert.match(csv, /"123\.45"/);
  assert.match(csv, /"'=HYPERLINK\(""example""\)"/);
});

test('transaction pagination enforces bounded page and page-size values', () => {
  assert.deepEqual(parseTransactionPagination({}), { page: 1, limit: 25 });
  assert.deepEqual(parseTransactionPagination({ page: '1000', limit: '100' }), {
    page: 1000,
    limit: 100
  });
  assert.equal(parseTransactionPagination({ page: '1001' }).error.status, 400);
  assert.equal(parseTransactionPagination({ page: '9999' }).error.status, 400);
  assert.equal(parseTransactionPagination({ page: ['2'] }).error.status, 400);
  assert.equal(parseTransactionPagination({ limit: '101' }).error.status, 400);
});
