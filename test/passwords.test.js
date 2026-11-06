const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { hashPassword, verifyPassword, needsPasswordRehash } = require('../lib/passwords');
const { parseAmountMinor } = require('../server');

test('bcrypt passwords are salted and verified without storing the original password', async () => {
  const password = 'correct horse battery staple';
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.match(firstHash, /^\$2[aby]\$12\$/);
  assert.notEqual(firstHash, secondHash);
  assert.equal(firstHash.includes(password), false);
  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(await verifyPassword('incorrect password', firstHash), false);
  assert.equal(needsPasswordRehash(firstHash), false);
});

test('legacy plaintext passwords can be checked for one-time hash migration', async () => {
  assert.equal(await verifyPassword('old password', undefined, 'old password'), true);
  assert.equal(await verifyPassword('wrong password', undefined, 'old password'), false);
  assert.equal(await verifyPassword('anything', undefined, ''), false);
});

test('legacy scrypt hashes can be verified and are marked for bcrypt migration', async () => {
  const salt = Buffer.alloc(16, 7);
  const key = await promisify(crypto.scrypt)('legacy scrypt password', salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  const legacyHash = `scrypt$32768$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;

  assert.equal(await verifyPassword('legacy scrypt password', legacyHash), true);
  assert.equal(await verifyPassword('wrong password', legacyHash), false);
  assert.equal(needsPasswordRehash(legacyHash), true);
});

test('malformed stored password hashes are rejected', async () => {
  assert.equal(await verifyPassword('password', 'scrypt$bad'), false);
  assert.equal(await verifyPassword('password', '$2b$bad'), false);
  assert.equal(needsPasswordRehash('scrypt$32768$8$1$salt$key'), true);
});

test('money input converts to integer cents and rejects invalid amounts', () => {
  assert.equal(parseAmountMinor('250.50'), 25050);
  assert.equal(parseAmountMinor('0.01'), 1);
  assert.equal(parseAmountMinor('1.234'), null);
  assert.equal(parseAmountMinor('-1.00'), null);
  assert.equal(parseAmountMinor('1000000000.00'), null);
});
