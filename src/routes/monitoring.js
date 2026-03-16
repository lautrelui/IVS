const express = require('express');
const { sessionAuth } = require('../auth/middleware');
const metricsStore = require('../monitoring/store');
const connectorRegistry = require('../connectors/registry');
const { getAuditEvents, getAuditCount, getAuditEventsByType } = require('../audit/logger');

const router = express.Router();

// All monitoring routes require session auth (dashboard login)
router.use(sessionAuth);

// Main metrics endpoint
router.get('/metrics', (_req, res) => {
  const metrics = metricsStore.getMetrics();
  const connectorStats = connectorRegistry.getAllStats();
  res.json({
    ...metrics,
    connectors: connectorStats,
  });
});

// Audit events
router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);
  const eventType = req.query.event_type;

  const events = eventType
    ? getAuditEventsByType(eventType, limit)
    : getAuditEvents(limit, offset);

  res.json({
    total: getAuditCount(),
    count: events.length,
    offset,
    events,
  });
});

// Recent requests
router.get('/recent', (_req, res) => {
  const metrics = metricsStore.getMetrics();
  res.json({
    recent_requests: metrics.recent_requests,
  });
});

module.exports = router;
