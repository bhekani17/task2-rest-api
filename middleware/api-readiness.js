function createApiReadinessMiddleware({ isDatabaseReady }) {
  return function apiReadiness(req, res, next) {
    if (!isDatabaseReady()) {
      return res.status(503).json({ error: 'The database is not ready yet.' });
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
          return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
        }
      } catch {
        return res.status(403).json({ error: 'Invalid request origin.' });
      }
    }
    next();
  };
}

module.exports = { createApiReadinessMiddleware };
