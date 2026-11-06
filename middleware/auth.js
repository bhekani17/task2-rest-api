function createAuthMiddleware({ loadSessionUser, clearSessionCookie, isDatabaseReady }) {
  async function requirePageAuth(req, res, next) {
    if (!isDatabaseReady()) return res.status(503).send('Bank services are not ready yet.');
    try {
      req.authUser = await loadSessionUser(req);
      if (!req.authUser) {
        clearSessionCookie(res);
        return res.redirect('/login');
      }
      next();
    } catch (error) {
      next(error);
    }
  }

  function requirePageAdmin(req, res, next) {
    requirePageAuth(req, res, (error) => {
      if (error) return next(error);
      if (req.authUser.role !== 'admin') return res.redirect('/dashboard');
      next();
    });
  }

  async function requireAuth(req, res, next) {
    try {
      req.authUser = await loadSessionUser(req);
      if (!req.authUser) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Sign in to continue.' });
      }
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireAdmin(req, res, next) {
    if (req.authUser?.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' });
    }
    next();
  }

  return { requirePageAuth, requirePageAdmin, requireAuth, requireAdmin };
}

module.exports = { createAuthMiddleware };
