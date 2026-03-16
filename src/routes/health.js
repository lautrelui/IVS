const express = require('express');
const { anyAuth } = require('../auth/middleware');
const connectorRegistry = require('../connectors/registry');
const config = require('../config');

const router = express.Router();

// Public health check
router.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'MTN IVS',
    instance: config.ivsInstanceId,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Protected connector health
router.get('/connectors', anyAuth, async (_req, res) => {
  const connectorHealth = await connectorRegistry.getAllHealth();
  res.json({
    status: 'ok',
    connectors: connectorHealth,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
