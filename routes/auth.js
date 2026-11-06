const crypto = require('node:crypto');

function registerAuthRoutes(app, dependencies) {
  const {
    requireAuth, requireAdmin, User, Account, Session, Activation,
    incrementAuthAttempts, clearAuthAttempts, nextUserId, nextAccountNumber,
    currentMonthKey, hashToken, readCookie, clearSessionCookie, setSessionCookie,
    publicUser, reportServerError, hashPassword, verifyPassword, needsPasswordRehash,
    mongoose, LOGIN_ATTEMPT_WINDOW_MS, SESSION_COOKIE
  } = dependencies;

  // Administrative customer creation is kept separate from self-service registration.
  app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    let session;
    try {
      const { name, email } = req.body || {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
          typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'A valid name and email address are required.' });
      }
  
      const userId = await nextUserId();
      const accountNumber = await nextAccountNumber();
      const activationToken = crypto.randomBytes(32).toString('base64url');
      let newUser;
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        [newUser] = await User.create([{
          userId,
          accountNumber,
          accountCount: 1,
          balanceMinor: 0,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          status: 'pending'
        }], { session });
        await Account.create([{
          ownerUserId: newUser._id,
          accountNumber,
          accountType: 'cheque',
          status: 'pending',
          balanceMinor: 0,
          lastInterestCreditedMonth: currentMonthKey()
        }], { session });
        await Activation.create([{
          tokenHash: hashToken(activationToken),
          userId: newUser._id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }], { session });
      });
      res.status(201).json({
        message: 'Customer account created. Customer activation is pending.',
        user: publicUser(newUser),
        activationPath: `/activate#token=${activationToken}`
      });
    } catch (error) {
      if (error.code === 'USER_IDS_EXHAUSTED') {
        return res.status(503).json({ error: error.message });
      }
      if (error.code === 'ACCOUNT_NUMBERS_EXHAUSTED') {
        return res.status(503).json({ error: error.message });
      }
      if (error.code === 20 || /transaction numbers are only allowed/i.test(String(error?.message || ''))) {
        return res.status(503).json({
          error: 'Customer account creation requires MongoDB running as a replica set.'
        });
      }
      if (error.code === 11000) {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }
      reportServerError(res, 'Customer creation', error);
    } finally {
      if (session) await session.endSession();
    }
  });
  
  // POST /api/auth/register creates a password-based account for the application.
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, password } = req.body || {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
          typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
          typeof password !== 'string' || password.length < 12 || password.length > 128) {
        return res.status(400).json({ error: 'Provide a valid name, email, and a 12-128 character password.' });
      }
      const attempt = await incrementAuthAttempts(req, 'register');
      if (attempt.count > 3) {
        res.setHeader('Retry-After', String(LOGIN_ATTEMPT_WINDOW_MS / 1000));
        return res.status(429).json({ error: 'Too many registration attempts. Try again in 15 minutes.' });
      }
  
      const normalizedEmail = String(email).trim().toLowerCase();
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }
  
      const userId = await nextUserId();
      const accountNumber = await nextAccountNumber();
      const newUser = new User({
        userId,
        accountNumber,
        accountCount: 1,
        balanceMinor: 0,
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: await hashPassword(password)
      });
      await newUser.save();
      await Account.create({
        ownerUserId: newUser._id,
        accountNumber,
        accountType: 'cheque',
        balanceMinor: 0,
        lastInterestCreditedMonth: currentMonthKey()
      });
      await setSessionCookie(newUser, res);
  
      res.status(201).json({
        message: 'Registration successful.',
        user: publicUser(newUser)
      });
    } catch (error) {
      if (error.code === 'USER_IDS_EXHAUSTED') {
        return res.status(503).json({ error: error.message });
      }
      if (error.code === 11000) {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }
      if (error.code === 'ACCOUNT_NUMBERS_EXHAUSTED') {
        return res.status(503).json({ error: error.message });
      }
      reportServerError(res, 'Registration', error);
    }
  });
  
  // POST /api/auth/login checks the email and password for a registered account.
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string' || !password || password.length > 128) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }
  
      const attempt = await incrementAuthAttempts(req, 'login');
      if (attempt.count > 5) {
        res.setHeader('Retry-After', String(LOGIN_ATTEMPT_WINDOW_MS / 1000));
        return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
      }
  
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail, status: 'active' }).select('+password +passwordHash');
      if (!user || !(await verifyPassword(password, user.passwordHash, user.password))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
  
      if (needsPasswordRehash(user.passwordHash)) {
        user.passwordHash = await hashPassword(password);
        user.password = undefined;
        await user.save();
      }
  
      await clearAuthAttempts(req, 'login');
      await setSessionCookie(user, res);
      res.status(200).json({
        message: 'Login successful.',
        user: publicUser(user)
      });
    } catch (error) {
      reportServerError(res, 'Login', error);
    }
  });
  
  app.post('/api/auth/activate', async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Activation link or password is invalid.' });
    }
  
    const attempt = await incrementAuthAttempts(req, 'activate');
    if (attempt.count > 5) {
      res.setHeader('Retry-After', String(LOGIN_ATTEMPT_WINDOW_MS / 1000));
      return res.status(429).json({ error: 'Too many activation attempts. Try again in 15 minutes.' });
    }
  
    const tokenHash = hashToken(token);
    const activationExists = await Activation.exists({
      tokenHash,
      expiresAt: { $gt: new Date() }
    });
    if (!activationExists) {
      return res.status(400).json({ error: 'Activation link is invalid or expired.' });
    }
  
    const passwordHash = await hashPassword(password);
    let session;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const activation = await Activation.findOne({
          tokenHash,
          expiresAt: { $gt: new Date() }
        }).session(session);
        if (!activation) {
          const error = new Error('Activation link is invalid or expired.');
          error.statusCode = 400;
          throw error;
        }
  
        const activatedUser = await User.findOneAndUpdate(
          { _id: activation.userId, status: 'pending' },
          { $set: { passwordHash, status: 'active' } },
          { new: true, session, runValidators: true }
        );
        if (!activatedUser) {
          const error = new Error('Activation link is invalid or expired.');
          error.statusCode = 400;
          throw error;
        }
  
        await Account.updateMany(
          { ownerUserId: activatedUser._id, status: 'pending' },
          { $set: { status: 'active' } },
          { session }
        );
        await Activation.deleteOne({ _id: activation._id }, { session });
      });
  
      res.status(200).json({ message: 'Account activated. You can now sign in.' });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (error.code === 20 || /transaction numbers are only allowed/i.test(String(error?.message || ''))) {
        return res.status(503).json({
          error: 'Account activation requires MongoDB running as a replica set.'
        });
      }
      reportServerError(res, 'Account activation', error);
    } finally {
      if (session) await session.endSession();
    }
  });
  
  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) await Session.deleteOne({ tokenHash: hashToken(token) });
      clearSessionCookie(res);
      res.status(200).json({ message: 'Signed out.' });
    } catch (error) {
      reportServerError(res, 'Sign out', error);
    }
  });
  
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.status(200).json({
      user: publicUser(req.authUser),
      demoDepositsEnabled: process.env.NODE_ENV !== 'production',
      savingsInterestEnabled: process.env.NODE_ENV !== 'production'
    });
  });
  
  app.use('/api', requireAuth);
}

module.exports = { registerAuthRoutes };
