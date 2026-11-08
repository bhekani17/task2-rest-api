const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAuthRoutes } = require('../routes/auth');

function createAuthHarness(overrides = {}) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
    put(path, ...handlers) { routes.set(`PUT ${path}`, handlers); },
    patch(path, ...handlers) { routes.set(`PATCH ${path}`, handlers); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers); },
    use() {}
  };
  const dependencies = {
    requireAuth: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
    User: {},
    Account: {},
    Session: {},
    Activation: {},
    incrementAuthAttempts: async () => ({ count: 1 }),
    clearAuthAttempts: async () => {},
    nextUserId: async () => 10001,
    nextAccountNumber: async () => '1234567890',
    currentMonthKey: () => '2026-11',
    hashToken: (token) => `hash:${token}`,
    readCookie: () => 'current-session-token',
    clearSessionCookie: () => {},
    setSessionCookie: async () => {},
    publicUser: (user) => ({
      id: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      accountNumber: user.accountNumber,
      balance: user.balanceMinor / 100
    }),
    reportServerError: (res) => res.status(500).json({ error: 'Internal error.' }),
    hashPassword: async (password) => `hash:${password}`,
    verifyPassword: async (password, passwordHash, legacyPassword) =>
      passwordHash === `hash:${password}` || legacyPassword === password,
    needsPasswordRehash: () => false,
    mongoose: {
      startSession: async () => ({
        withTransaction: async (operation) => operation(),
        endSession: async () => {}
      })
    },
    LOGIN_ATTEMPT_WINDOW_MS: 900000,
    SESSION_COOKIE: 'skybank_session',
    ...overrides
  };
  registerAuthRoutes(app, dependencies);
  return routes;
}

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function call(handlers, req) {
  const res = response();
  let endpoint;
  await handlers[0](req, res, () => {
    endpoint = handlers[1](req, res, () => {});
  });
  if (endpoint) await endpoint;
  return res;
}

test('customers can update only their own name and verified email', async () => {
  const user = {
    _id: 'user-id',
    userId: 12345,
    name: 'Old Name',
    email: 'old@example.com',
    passwordHash: 'hash:current-password',
    status: 'active',
    role: 'customer',
    accountNumber: '1234567890',
    balanceMinor: 12500
  };
  let savedUpdates;
  const routes = createAuthHarness({
    User: {
      findById: () => {
        return {
          select: async () => user,
          then: (resolve, reject) => Promise.resolve(user).then(resolve, reject)
        };
      },
      updateOne: async (_filter, update) => {
        savedUpdates = update.$set;
        Object.assign(user, update.$set);
        return { matchedCount: 1 };
      }
    }
  });
  const handlers = routes.get('PATCH /api/auth/profile');

  const missingPassword = await call(handlers, {
    authUser: { _id: 'user-id' },
    body: { email: ' New@Example.com ' }
  });
  assert.equal(missingPassword.statusCode, 401);
  assert.equal(savedUpdates, undefined);

  const updated = await call(handlers, {
    authUser: { _id: 'user-id' },
    body: {
      name: '  New Name  ',
      email: ' New@Example.com ',
      currentPassword: 'current-password'
    }
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(savedUpdates, { name: 'New Name', email: 'new@example.com' });
  assert.equal(updated.body.user.name, 'New Name');
  assert.equal(updated.body.user.email, 'new@example.com');

  const protectedField = await call(handlers, {
    authUser: { _id: 'user-id' },
    body: { role: 'admin' }
  });
  assert.equal(protectedField.statusCode, 400);
});

test('password changes require the current password and revoke other sessions', async () => {
  const user = {
    _id: 'user-id',
    passwordHash: 'hash:current-password',
    password: undefined,
    status: 'active'
  };
  let passwordUpdate;
  let revokedSessions;
  const routes = createAuthHarness({
    User: {
      findOne: () => ({
        select() {
          return {
            session: async () => user
          };
        }
      }),
      updateOne: async (_filter, update) => {
        passwordUpdate = update;
        return { matchedCount: 1 };
      }
    },
    Session: {
      deleteMany: async (filter) => {
        revokedSessions = filter;
        return { deletedCount: 1 };
      }
    }
  });
  const handlers = routes.get('PUT /api/auth/password');

  const wrongPassword = await call(handlers, {
    authUser: { _id: 'user-id' },
    body: { currentPassword: 'wrong-password', newPassword: 'new-secure-password' }
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(passwordUpdate, undefined);

  const updated = await call(handlers, {
    authUser: { _id: 'user-id' },
    body: { currentPassword: 'current-password', newPassword: 'new-secure-password' }
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(passwordUpdate, {
    $set: { passwordHash: 'hash:new-secure-password' },
    $unset: { password: 1 }
  });
  assert.deepEqual(revokedSessions, {
    userId: 'user-id',
    tokenHash: { $ne: 'hash:current-session-token' }
  });
});

test('admin registration requires a valid code and does not create a personal bank account', async () => {
  const previousCode = process.env.ADMIN_REGISTRATION_CODE;
  process.env.ADMIN_REGISTRATION_CODE = 'secret-admin-code-2026';
  let createdUser;
  let accountCreated = false;
  let accountNumberRequested = false;

  try {
    const routes = createAuthHarness({
      nextAccountNumber: async () => {
        accountNumberRequested = true;
        return '1234567890';
      },
      User: {
        findOne: async () => null,
        create: async ([doc]) => {
          createdUser = { _id: 'admin-id', status: 'active', ...doc };
          return [createdUser];
        }
      },
      Account: {
        create: async () => {
          accountCreated = true;
        }
      }
    });
    const handler = routes.get('POST /api/auth/register')[0];

    const invalidCodeRes = response();
    await handler({
      body: {
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'secure-admin-password',
        adminCode: 'wrong-code'
      }
    }, invalidCodeRes);
    assert.equal(invalidCodeRes.statusCode, 403);
    assert.equal(createdUser, undefined);

    const validCodeRes = response();
    await handler({
      body: {
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'secure-admin-password',
        adminCode: 'secret-admin-code-2026'
      }
    }, validCodeRes);
    assert.equal(validCodeRes.statusCode, 201);
    assert.equal(createdUser.role, 'admin');
    assert.equal(createdUser.accountCount, 0);
    assert.equal(createdUser.accountNumber, undefined);
    assert.equal(accountCreated, false);
    assert.equal(accountNumberRequested, false);
  } finally {
    if (previousCode === undefined) delete process.env.ADMIN_REGISTRATION_CODE;
    else process.env.ADMIN_REGISTRATION_CODE = previousCode;
  }
});
