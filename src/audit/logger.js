const winston = require('winston');

const auditEvents = [];
const MAX_AUDIT_EVENTS = 10000;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'mtn-ivs' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

function auditLog(eventType, data) {
  const event = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Never log raw identifier values
  delete event.raw_value;
  delete event.raw_identifier;

  auditEvents.unshift(event);
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.length = MAX_AUDIT_EVENTS;
  }

  logger.info(`[AUDIT] ${eventType}`, {
    correlation_id: data.correlation_id,
    identifier_type: data.identifier_type,
    masked_value: data.masked_value,
    status: data.status,
  });

  return event;
}

function getAuditEvents(limit = 100, offset = 0) {
  return auditEvents.slice(offset, offset + limit);
}

function getAuditCount() {
  return auditEvents.length;
}

function getAuditEventsByType(eventType, limit = 100) {
  return auditEvents.filter(e => e.event_type === eventType).slice(0, limit);
}

module.exports = { logger, auditLog, getAuditEvents, getAuditCount, getAuditEventsByType };
