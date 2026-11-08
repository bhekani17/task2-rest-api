const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

function createSessionService({ Session, secret, cookieName, durationMs, issuer, production }) {
  function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  function readCookie(req, name = cookieName) {
    const cookies = (req.headers.cookie || '').split(';');
    const entry = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
    const token = entry ? entry.trim().slice(name.length + 1) : '';
    return /^[A-Za-z0-9_.-]{1,2048}$/.test(token) ? token : null;
  }

  function clearSessionCookie(res) {
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`
    );
  }

  async function setSessionCookie(user, res, req = null) {
    const token = jwt.sign(
      { jti: crypto.randomUUID() },
      secret,
      {
        algorithm: 'HS256',
        subject: String(user._id),
        issuer,
        expiresIn: durationMs / 1000
      }
    );
    const ipAddress = typeof req?.ip === 'string' ? req.ip.slice(0, 80) : '';
    const userAgent = typeof req?.get === 'function' ? String(req.get('user-agent') || '').slice(0, 180) : '';
    await Session.create({
      tokenHash: hashToken(token),
      userId: user._id,
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + durationMs)
    });

    const secure = production ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${durationMs / 1000}${secure}`
    );
  }

  async function loadSessionUser(req) {
    const token = readCookie(req);
    if (!token) return null;

    let claims;
    try {
      claims = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer
      });
    } catch {
      return null;
    }
    if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string') return null;

    const session = await Session.findOne({
      tokenHash: hashToken(token),
      userId: claims.sub,
      expiresAt: { $gt: new Date() }
    }).populate('userId', '_id userId name email accountNumber balanceMinor role status profilePhotoContentType');
    return session?.userId?.status === 'active' ? session.userId : null;
  }

  return { hashToken, readCookie, clearSessionCookie, setSessionCookie, loadSessionUser };
}

module.exports = { createSessionService };
