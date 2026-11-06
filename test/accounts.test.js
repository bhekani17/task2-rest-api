const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTransactionFilter,
  currentMonthKey,
  nextMonthKey,
  previousMonthKey,
  monthlySavingsInterestMinor,
  MAX_ACCOUNTS_PER_USER,
  accountLimitReached
} = require('../server');

test('customers may open at most three active accounts', () => {
  assert.equal(MAX_ACCOUNTS_PER_USER, 3);
  assert.equal(accountLimitReached(2), false);
  assert.equal(accountLimitReached(3), true);
});

test('transaction filters scope customers to every owned account', () => {
  const result = buildTransactionFilter(
    { accountNumber: '1000000002' },
    { role: 'customer', accountNumber: '1000000001' },
    ['1000000001', '1000000002']
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.filter.$and[0], {
    $or: [
      { fromAccount: { $in: ['1000000001', '1000000002'] } },
      { toAccount: { $in: ['1000000001', '1000000002'] } }
    ]
  });
  assert.deepEqual(result.filter.$and[1], {
    $or: [{ fromAccount: '1000000002' }, { toAccount: '1000000002' }]
  });
  assert.equal(
    buildTransactionFilter(
      { accountNumber: '1000000003' },
      { role: 'customer', accountNumber: '1000000001' },
      ['1000000001', '1000000002']
    ).error.status,
    403
  );
});

test('savings interest uses one percent monthly with cent rounding', () => {
  assert.equal(monthlySavingsInterestMinor(10000), 100);
  assert.equal(monthlySavingsInterestMinor(10050), 101);
  assert.equal(monthlySavingsInterestMinor(49), 0);
  assert.equal(
    buildTransactionFilter(
      { type: 'interest' },
      { role: 'customer', accountNumber: '1000000001' },
      ['1000000001']
    ).error,
    undefined
  );
});

test('monthly interest period keys handle year boundaries', () => {
  assert.equal(previousMonthKey('2027-01'), '2026-12');
  assert.equal(nextMonthKey('2026-12'), '2027-01');
  assert.match(currentMonthKey(new Date('2026-11-06T01:00:00.000Z')), /^2026-11$/);
});
