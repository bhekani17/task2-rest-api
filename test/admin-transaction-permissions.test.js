const test = require('node:test');
const assert = require('node:assert/strict');
const { registerTransactionRoutes } = require('../routes/transactions');

test('administrator transaction requests are rejected before transaction validation', async () => {
  let handlers;
  const app = {
    get() {},
    post(path, ...routeHandlers) {
      if (path === '/api/transactions') handlers = routeHandlers;
    }
  };
  registerTransactionRoutes(app, {});

  const req = { body: {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  req.authUser = { role: 'admin', _id: 'admin-id' };
  await handlers[0](req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Administrators cannot create transactions.' });
});
