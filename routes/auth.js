const crypto = require('node:crypto');
const express = require('express');
const { detectProfilePhotoType } = require('../lib/profile-photo');

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

  app.patch('/api/auth/profile', requireAuth, async (req, res) => {
    const body = req.body || {};
    const allowedFields = new Set(['name', 'email', 'currentPassword']);
    if (Object.keys(body).some((field) => !allowedFields.has(field))) {
      return res.status(400).json({ error: 'Only profile name and email can be updated here.' });
    }

    const updates = {};
    if (Object.hasOwn(body, 'name')) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
        return res.status(400).json({ error: 'Name must be between 1 and 100 characters.' });
      }
      updates.name = body.name.trim();
    }
    if (Object.hasOwn(body, 'email')) {
      if (typeof body.email !== 'string' || body.email.trim().length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        return res.status(400).json({ error: 'Provide a valid email address.' });
      }
      updates.email = body.email.trim().toLowerCase();
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Provide a name or email to update.' });
    }

    try {
      const currentUser = await User.findById(req.authUser._id).select('+password +passwordHash');
      if (!currentUser || currentUser.status !== 'active') {
        return res.status(401).json({ error: 'Your active user profile could not be found.' });
      }
      if (updates.email && updates.email !== currentUser.email) {
        if (typeof body.currentPassword !== 'string' || !body.currentPassword ||
            body.currentPassword.length > 128 ||
            !await verifyPassword(body.currentPassword, currentUser.passwordHash, currentUser.password)) {
          return res.status(401).json({ error: 'Enter your current password to change your email.' });
        }
      }

      const result = await User.updateOne(
        { _id: currentUser._id, status: 'active' },
        { $set: updates }
      );
      if (result.matchedCount !== 1) {
        return res.status(409).json({ error: 'Your profile changed or became unavailable. Reload and try again.' });
      }
      const updatedUser = await User.findById(currentUser._id);
      res.status(200).json({ message: 'Profile updated.', user: publicUser(updatedUser) });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }
      reportServerError(res, 'Profile update', error);
    }
  });

  app.put('/api/auth/password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 128 ||
        typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
      return res.status(400).json({ error: 'Enter your current password and a new password of 12 to 128 characters.' });
    }

    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return res.status(401).json({ error: 'Sign in again before changing your password.' });

    let session;
    try {
      const newPasswordHash = await hashPassword(newPassword);
      const currentTokenHash = hashToken(token);
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const currentUser = await User.findOne({
          _id: req.authUser._id,
          status: 'active'
        }).select('+password +passwordHash').session(session);
        if (!currentUser ||
            !await verifyPassword(currentPassword, currentUser.passwordHash, currentUser.password)) {
          const error = new Error('Current password is incorrect.');
          error.statusCode = 401;
          throw error;
        }
        if (await verifyPassword(newPassword, currentUser.passwordHash, currentUser.password)) {
          const error = new Error('Choose a new password that is different from your current password.');
          error.statusCode = 400;
          throw error;
        }

        const updated = await User.updateOne(
          { _id: currentUser._id, status: 'active' },
          { $set: { passwordHash: newPasswordHash }, $unset: { password: 1 } },
          { session }
        );
        if (updated.matchedCount !== 1) {
          throw new Error('The active user profile could not be updated.');
        }
        await Session.deleteMany(
          { userId: currentUser._id, tokenHash: { $ne: currentTokenHash } },
          { session }
        );
      });
      res.status(200).json({
        message: 'Password changed. Other active sessions have been signed out.'
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (error.code === 20 || /transaction numbers are only allowed/i.test(String(error?.message || ''))) {
        return res.status(503).json({
          error: 'Password changes require MongoDB running as a replica set.'
        });
      }
      reportServerError(res, 'Password change', error);
    } finally {
      if (session) await session.endSession();
    }
  });

  const profilePhotoParser = express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '2mb'
  });
  app.put('/api/auth/profile/photo', requireAuth, (req, res, next) => {
    profilePhotoParser(req, res, (error) => {
      if (!error) return next();
      if (error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Profile photos must be 2 MB or smaller.' });
      }
      return res.status(400).json({ error: 'Profile photo upload could not be read.' });
    });
  }, async (req, res) => {
    const contentType = req.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return res.status(415).json({ error: 'Upload a JPEG, PNG, or WebP image.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Choose a profile photo to upload.' });
    }
    const detectedType = detectProfilePhotoType(req.body);
    if (detectedType !== contentType) {
      return res.status(400).json({ error: 'The image content does not match its file type.' });
    }

    try {
      await User.updateOne(
        { _id: req.authUser._id, status: 'active' },
        { $set: { profilePhoto: req.body, profilePhotoContentType: detectedType } }
      );
      res.status(200).json({ message: 'Profile photo updated.' });
    } catch (error) {
      reportServerError(res, 'Profile photo update', error);
    }
  });

  app.get('/api/auth/profile/photo', requireAuth, async (req, res) => {
    try {
      const user = await User.findById(req.authUser._id).select('+profilePhoto profilePhotoContentType');
      if (!user?.profilePhoto || !user.profilePhotoContentType) {
        return res.status(404).json({ error: 'No profile photo has been uploaded.' });
      }
      res.set({
        'Content-Type': user.profilePhotoContentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.status(200).send(user.profilePhoto);
    } catch (error) {
      reportServerError(res, 'Profile photo retrieval', error);
    }
  });

  app.delete('/api/auth/profile/photo', requireAuth, async (req, res) => {
    try {
      await User.updateOne(
        { _id: req.authUser._id },
        { $unset: { profilePhoto: 1, profilePhotoContentType: 1 } }
      );
      res.status(200).json({ message: 'Profile photo removed.' });
    } catch (error) {
      reportServerError(res, 'Profile photo removal', error);
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
