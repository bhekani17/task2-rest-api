// Load environment variables such as MONGODB_URI and PORT from the local .env file.
// This keeps database credentials and runtime config out of the source code.
require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const { Server: SocketIOServer } = require('socket.io');
const { hashPassword, verifyPassword, needsPasswordRehash } = require('./lib/passwords');
const { createSessionService } = require('./lib/session');
const { createAuthMiddleware } = require('./middleware/auth');
const { createApiReadinessMiddleware } = require('./middleware/api-readiness');
const { reportServerError, publicUser } = require('./lib/http');
const {
  MAX_ACCOUNTS_PER_USER, User, Account, Session, LoginAttempt, Activation,
  Transaction, Counter, StockPortfolio, StockTrade
} = require('./models');

// Create the Express application and choose the port to listen on.
// PORT defaults to 5000 so the app can still run locally when no environment variable is set.
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));
const SESSION_COOKIE = 'skybank_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const SESSION_ISSUER = 'sky-bank';
const SYSTEM_ACTOR_USER_ID = new mongoose.Types.ObjectId('000000000000000000000000');
let databaseReady = false;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '16kb' }));
app.use('/css', express.static(path.join(__dirname, 'client', 'css'), { index: false }));
app.use('/js', express.static(path.join(__dirname, 'client', 'js'), { index: false }));
app.use('/admin/css', express.static(path.join(__dirname, 'admin', 'css'), { index: false }));
app.use('/admin/js', express.static(path.join(__dirname, 'admin', 'js'), { index: false }));

const sessionService = createSessionService({
  Session,
  secret: JWT_SECRET,
  cookieName: SESSION_COOKIE,
  durationMs: SESSION_DURATION_MS,
  issuer: SESSION_ISSUER,
  production: process.env.NODE_ENV === 'production'
});
const {
  hashToken, readCookie, clearSessionCookie, setSessionCookie, loadSessionUser
} = sessionService;
const {
  requirePageAuth, requirePageAdmin, requireAuth, requireAdmin
} = createAuthMiddleware({
  loadSessionUser,
  clearSessionCookie,
  isDatabaseReady: () => databaseReady
});

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { maxHttpBufferSize: 10_000 });

io.use(async (socket, next) => {
  try {
    const origin = socket.request.headers.origin;
    if (origin && new URL(origin).host !== socket.request.headers.host) {
      return next(new Error('Invalid origin.'));
    }
    const user = await loadSessionUser(socket.request);
    if (!user) return next(new Error('Authentication required.'));
    socket.data.userId = String(user._id);
    next();
  } catch (error) {
    next(error);
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.data.userId}`);
});

async function incrementAuthAttempts(req, scope) {
  const now = new Date();
  return LoginAttempt.findOneAndUpdate(
    { _id: hashToken(`${scope}:${req.ip || 'unknown'}`) },
    [{
      $set: {
        count: {
          $cond: [
            { $gt: ['$expiresAt', now] },
            { $add: [{ $ifNull: ['$count', 0] }, 1] },
            1
          ]
        },
        expiresAt: {
          $cond: [
            { $gt: ['$expiresAt', now] },
            '$expiresAt',
            new Date(Date.now() + LOGIN_ATTEMPT_WINDOW_MS)
          ]
        }
      }
    }],
    { upsert: true, new: true, updatePipeline: true }
  );
}

function clearAuthAttempts(req, scope) {
  return LoginAttempt.deleteOne({
    _id: hashToken(`${scope}:${req.ip || 'unknown'}`)
  });
}

const { createAccountService } = require('./services/account-service');

const accountService = createAccountService({
  User, Account, Counter, Transaction, Session, LoginAttempt, Activation,
  StockPortfolio, StockTrade,
  mongoose, io, SYSTEM_ACTOR_USER_ID,
  MAX_ACCOUNTS_PER_USER
});
const {
  nextUserId, nextAccountNumber, initializeUserIds, accountLimitReached,
  currentMonthKey, previousMonthKey, nextMonthKey, monthlySavingsInterestMinor,
  ownedAccountNumbers, creditMonthlySavingsInterest
} = accountService;

const { parseAmountMinor, transactionResponse, buildTransactionFilter, parseTransactionPagination, transactionCsv } = require('./services/transaction-service');
const { registerAuthRoutes } = require('./routes/auth');
const { registerAccountRoutes } = require('./routes/accounts');
const { registerTransactionRoutes } = require('./routes/transactions');
const { registerAdminRoutes } = require('./routes/admin');
const { registerPageRoutes } = require('./routes/pages');
const { registerInvestmentRoutes } = require('./routes/investments');

registerPageRoutes(app, {
  loadSessionUser,
  readCookie,
  clearSessionCookie,
  requirePageAuth,
  requirePageAdmin,
  isDatabaseReady: () => databaseReady,
  rootDirectory: __dirname,
  SESSION_COOKIE
});
app.use('/api', createApiReadinessMiddleware({ isDatabaseReady: () => databaseReady }));

registerAuthRoutes(app, {
  requireAuth, requireAdmin, User, Account, Session, Activation,
  incrementAuthAttempts, clearAuthAttempts, nextUserId, nextAccountNumber,
  currentMonthKey, hashToken, readCookie, clearSessionCookie, setSessionCookie,
  publicUser, reportServerError, hashPassword, verifyPassword, needsPasswordRehash,
  mongoose, LOGIN_ATTEMPT_WINDOW_MS, SESSION_COOKIE
});
registerAccountRoutes(app, {
  requireAdmin, User, Account, publicUser, reportServerError, currentMonthKey,
  nextAccountNumber, MAX_ACCOUNTS_PER_USER, accountLimitReached
});
registerTransactionRoutes(app, {
  User, Account, Transaction, reportServerError, mongoose, io,
  ownedAccountNumbers, buildTransactionFilter, transactionCsv,
  parseTransactionPagination, transactionResponse, parseAmountMinor
});
registerInvestmentRoutes(app, {
  User, Account, Transaction, StockPortfolio, StockTrade, mongoose, reportServerError
});
registerAdminRoutes(app, {
  requireAdmin, User, Account, Session, Transaction, mongoose, publicUser, reportServerError
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  reportServerError(res, 'Request', error);
});

async function startServer() {
  if (process.env.NODE_ENV === 'production' && (!JWT_SECRET || JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production.');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured before starting the server.');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  await initializeUserIds();
  databaseReady = true;
  const interestTimer = setInterval(() => {
    creditMonthlySavingsInterest().catch((error) => {
      const detail = typeof error?.message === 'string'
        ? error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[redacted MongoDB URI]').slice(0, 300)
        : '';
      console.error(`Monthly savings interest failed: ${error?.name || 'Error'}${detail ? `: ${detail}` : ''}`);
    });
  }, 60 * 60 * 1000);
  interestTimer.unref();
  creditMonthlySavingsInterest().catch((error) => {
    const detail = typeof error?.message === 'string'
      ? error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[redacted MongoDB URI]').slice(0, 300)
      : '';
    console.error(`Monthly savings interest failed: ${error?.name || 'Error'}${detail ? `: ${detail}` : ''}`);
  });
  return httpServer.listen(PORT, () => {
    console.log(`Sky Bank server running on port ${PORT}.`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Server startup failed: ${error?.name || 'Error'}`);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  io,
  startServer,
  parseAmountMinor,
  currentMonthKey,
  nextMonthKey,
  previousMonthKey,
  MAX_ACCOUNTS_PER_USER,
  accountLimitReached,
  monthlySavingsInterestMinor,
  transactionResponse,
  buildTransactionFilter,
  parseTransactionPagination,
  transactionCsv
};