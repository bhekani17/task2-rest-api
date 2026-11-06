const path = require('node:path');
const brandImages = new Set(['logo.png', 'bg.png', 'home.png']);

function registerPageRoutes(app, dependencies) {
  const {
    loadSessionUser,
    readCookie,
    clearSessionCookie,
    requirePageAuth,
    requirePageAdmin,
    isDatabaseReady,
    rootDirectory,
    SESSION_COOKIE
  } = dependencies;

  const sendClientPage = (page) => (req, res) => {
    res.sendFile(path.join(rootDirectory, 'client', page));
  };
  const sendAdminPage = (page) => (req, res) => {
    res.sendFile(path.join(rootDirectory, 'admin', page));
  };

  app.get('/images/:imageName', (req, res, next) => {
    if (!brandImages.has(req.params.imageName)) {
      return next();
    }
    res.type('image/png').sendFile(path.join(rootDirectory, 'images', req.params.imageName));
  });

  app.get('/', async (req, res, next) => {
    try {
      if (isDatabaseReady() && await loadSessionUser(req)) {
        return res.redirect('/dashboard');
      }
      if (readCookie(req, SESSION_COOKIE)) clearSessionCookie(res);
      sendClientPage('welcome.html')(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.get('/dashboard', requirePageAuth, sendClientPage('index.html'));
  app.get('/profile', requirePageAuth, sendClientPage('profile.html'));
  app.get('/accounts', requirePageAuth, sendClientPage('accounts.html'));
  app.get('/transfers', requirePageAuth, sendClientPage('transfers.html'));
  app.get('/transactions', requirePageAuth, sendClientPage('transactions.html'));
  app.get('/investments', requirePageAuth, (req, res, next) => {
    if (req.authUser.role !== 'customer') return res.redirect('/dashboard');
    sendClientPage('investments.html')(req, res, next);
  });
  app.get('/admin', requirePageAdmin, sendAdminPage('create.html'));
  app.get('/create', requirePageAdmin, sendAdminPage('create.html'));

  async function redirectAuthenticatedCustomer(req, res, next) {
    try {
      if (isDatabaseReady() && await loadSessionUser(req)) {
        return res.redirect('/dashboard');
      }
      next();
    } catch (error) {
      next(error);
    }
  }

  app.get('/register', redirectAuthenticatedCustomer, sendClientPage('register.html'));
  app.get('/activate', sendClientPage('activate.html'));
  app.get('/health', (req, res) => {
    const ready = isDatabaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'starting' });
  });
  app.get('/login', redirectAuthenticatedCustomer, sendClientPage('login.html'));
}

module.exports = { registerPageRoutes };
