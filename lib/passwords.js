const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const scryptAsync = require('util').promisify(crypto.scrypt);
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const BCRYPT_COST = 12;

function bcryptInput(password) {
  // Hash first so bcrypt's 72-byte input limit cannot truncate long passwords.
  return crypto.createHash('sha256').update(password, 'utf8').digest('base64');
}

async function hashPassword(password) {
  return bcrypt.hash(bcryptInput(password), BCRYPT_COST);
}

async function verifyPassword(password, passwordHash, legacyPassword) {
  if (passwordHash) {
    if (passwordHash.startsWith('$2')) {
      return BCRYPT_HASH_PATTERN.test(passwordHash) &&
        bcrypt.compare(bcryptInput(password), passwordHash);
    }

    const parts = passwordHash.split('$');
    if (parts.length !== 6) return false;
    const [scheme, cost, blockSize, parallelization, saltText, keyText] = parts;
    if (scheme !== 'scrypt' || cost !== '32768' || blockSize !== '8' || parallelization !== '1') {
      return false;
    }

    const salt = Buffer.from(saltText, 'base64url');
    const expectedKey = Buffer.from(keyText, 'base64url');
    if (salt.length !== 16 || expectedKey.length !== 64) return false;
    const actualKey = await scryptAsync(password, salt, expectedKey.length, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    });
    return crypto.timingSafeEqual(expectedKey, actualKey);
  }

  if (typeof legacyPassword !== 'string' || !legacyPassword) return false;
  const submittedDigest = crypto.createHash('sha256').update(password).digest();
  const legacyDigest = crypto.createHash('sha256').update(legacyPassword).digest();
  return crypto.timingSafeEqual(submittedDigest, legacyDigest);
}

function needsPasswordRehash(passwordHash) {
  return !BCRYPT_HASH_PATTERN.test(passwordHash || '');
}

module.exports = { hashPassword, verifyPassword, needsPasswordRehash };
