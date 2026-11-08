function reportServerError(res, context, error) {
  const code = ['string', 'number'].includes(typeof error?.code)
    ? ` code=${String(error.code).slice(0, 40)}`
    : '';
  const detail = typeof error?.message === 'string'
    ? error.message
      .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[redacted MongoDB URI]')
      .replace(/(password|passwd|pwd|email)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
      .replace(/value:\s*(['"]).*?\1/gi, 'value: [redacted]')
      .slice(0, 400)
    : '';
  console.error(`${context} failed: ${error?.name || 'Error'}${code}${detail ? `: ${detail}` : ''}`);
  if (!res.headersSent) res.status(500).json({ error: 'An internal server error occurred.' });
}

function publicUser(user) {
  const isAdmin = user.role === 'admin';
  return {
    id: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    hasProfilePhoto: Boolean(user.profilePhotoContentType),
    accountNumber: isAdmin ? null : (user.accountNumber || null),
    balance: isAdmin ? 0 : user.balanceMinor / 100,
    currency: 'ZAR'
  };
}

module.exports = { reportServerError, publicUser };
