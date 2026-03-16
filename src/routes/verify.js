const express = require('express');
const { apiKeyAuth } = require('../auth/middleware');
const { verifyIdentifier } = require('../services/verification');
const metricsStore = require('../monitoring/store');
const { SUPPORTED_TYPES } = require('../normalization/normalizer');

const router = express.Router();

router.post('/', apiKeyAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    const { correlation_id, identifier, source_context, options } = req.body;

    // Validate request structure
    if (!correlation_id) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'correlation_id is required' });
    }
    if (!identifier || !identifier.identifier_type || !identifier.raw_value || !identifier.issuer_country) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'identifier.identifier_type, identifier.raw_value, and identifier.issuer_country are required',
        correlation_id,
      });
    }
    if (!SUPPORTED_TYPES.includes(identifier.identifier_type)) {
      return res.status(400).json({
        error: 'UNSUPPORTED_TYPE',
        message: `Unsupported identifier_type. Supported: ${SUPPORTED_TYPES.join(', ')}`,
        correlation_id,
      });
    }

    metricsStore.recordRequest('verify', {
      identifier_type: identifier.identifier_type,
      issuer_country: identifier.issuer_country,
    });

    const result = await verifyIdentifier({
      correlation_id,
      identifier,
      source_context: source_context || {},
      options: options || {},
    });

    const responseTimeMs = Date.now() - startTime;
    metricsStore.recordResponseTime(responseTimeMs);
    metricsStore.recordResult(
      result.claim?.verification_status || result.error_code?.toLowerCase() || 'error',
      {
        correlation_id,
        identifier_type: identifier.identifier_type,
        issuer_country: identifier.issuer_country,
        masked_value: result.claim?.masked_value,
        response_time_ms: responseTimeMs,
        gateway_id: source_context?.gateway_id,
      }
    );

    if (result.status === 'error') {
      const httpStatus = result.error_code === 'FORMAT_ERROR' ? 400
        : result.error_code === 'NO_CONNECTOR' ? 422
        : result.error_code === 'REGISTRY_UNAVAILABLE' ? 502
        : 500;
      return res.status(httpStatus).json(result);
    }

    return res.json(result);

  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    metricsStore.recordResponseTime(responseTimeMs);
    metricsStore.recordResult('error', {
      correlation_id: req.body?.correlation_id,
      response_time_ms: responseTimeMs,
    });

    return res.status(500).json({
      status: 'error',
      error_code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      correlation_id: req.body?.correlation_id,
    });
  }
});

module.exports = router;
