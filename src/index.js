const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');
const { logger } = require('./audit/logger');
const { login, sessionAuth } = require('./auth/middleware');

const verifyRoutes = require('./routes/verify');
const protectRoutes = require('./routes/protect');
const healthRoutes = require('./routes/health');
const monitoringRoutes = require('./routes/monitoring');
const claimsRoutes = require('./routes/claims');

const app = express();

// Security
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  // Disable HSTS — service runs over HTTP, not behind HTTPS termination by default
  strictTransportSecurity: false,
  // Allow same-origin and cross-origin resource loading for static assets
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Rate limiting for API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'RATE_LIMITED', message: 'Too many login attempts' },
});

// API routes
app.use('/api/v1/identifiers/verify', apiLimiter, verifyRoutes);
app.use('/api/v1/identifiers/protect', apiLimiter, protectRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/connectors/health', healthRoutes);
app.use('/api/v1/monitoring', monitoringRoutes);
app.use('/api/v1/claims', claimsRoutes);

// Auth routes
app.post('/auth/login', loginLimiter, login);
app.post('/auth/logout', (_req, res) => {
  res.clearCookie('ivs_session');
  res.json({ status: 'ok' });
});
app.get('/auth/check', sessionAuth, (req, res) => {
  res.json({ status: 'ok', user: req.user });
});

// Dashboard static files — served at root since this is a dedicated service on port 3011
app.use(express.static(path.join(__dirname, '..', 'public')));

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
});

app.listen(config.port, '0.0.0.0', () => {
  logger.info(`MTN IVS started on port ${config.port}`, {
    instance: config.ivsInstanceId,
    environment: config.nodeEnv,
  });
});

module.exports = app;
