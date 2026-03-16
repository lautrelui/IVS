const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const config = require('../config');

// Pre-hash the admin password at startup
let adminPasswordHash = null;
(async () => {
  adminPasswordHash = await bcryptjs.hash(config.auth.adminPassword, 10);
})();

/**
 * API Key authentication for gateway (CVG) requests.
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !config.apiKeys.includes(apiKey)) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or missing API key',
    });
  }
  req.authenticatedVia = 'api_key';
  next();
}

/**
 * JWT session authentication for dashboard/admin access.
 */
function sessionAuth(req, res, next) {
  const token = req.cookies?.ivs_session || req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Session required' });
  }
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    req.user = decoded;
    req.authenticatedVia = 'session';
    next();
  } catch {
    return res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Session expired or invalid' });
  }
}

/**
 * Login handler.
 */
async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Username and password required' });
  }

  if (username !== config.auth.adminUsername) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid credentials' });
  }

  const valid = await bcryptjs.compare(password, adminPasswordHash);
  if (!valid) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { username, role: 'admin' },
    config.auth.jwtSecret,
    { expiresIn: '8h' }
  );

  // Only set Secure flag when behind HTTPS (controlled via COOKIE_SECURE env).
  // Browsers silently drop Secure cookies over plain HTTP, breaking login.
  const isSecure = process.env.COOKIE_SECURE === 'true' ||
    (req.protocol === 'https') ||
    (req.headers['x-forwarded-proto'] === 'https');

  res.cookie('ivs_session', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: config.auth.sessionMaxAge,
  });

  return res.json({ status: 'ok', token });
}

/**
 * Either API key or session auth.
 */
function anyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && config.apiKeys.includes(apiKey)) {
    req.authenticatedVia = 'api_key';
    return next();
  }

  const token = req.cookies?.ivs_session || req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      req.user = decoded;
      req.authenticatedVia = 'session';
      return next();
    } catch {
      // Fall through
    }
  }

  return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
}

module.exports = { apiKeyAuth, sessionAuth, anyAuth, login };
