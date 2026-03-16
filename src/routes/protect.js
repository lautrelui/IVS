const express = require('express');
const { apiKeyAuth } = require('../auth/middleware');
const { normalize, SUPPORTED_TYPES } = require('../normalization/normalizer');
const { generateIdentifierHmac, generateMaskedValue, generateFingerprint } = require('../crypto/hmac');
const { signClaim } = require('../crypto/signing');
const { auditLog } = require('../audit/logger');
const config = require('../config');
const metricsStore = require('../monitoring/store');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

router.post('/', apiKeyAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    const { correlation_id, identifier } = req.body;

    if (!correlation_id || !identifier || !identifier.identifier_type || !identifier.raw_value || !identifier.issuer_country) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'correlation_id, identifier.identifier_type, identifier.raw_value, and identifier.issuer_country are required',
      });
    }

    if (!SUPPORTED_TYPES.includes(identifier.identifier_type)) {
      return res.status(400).json({
        error: 'UNSUPPORTED_TYPE',
        message: `Unsupported identifier_type. Supported: ${SUPPORTED_TYPES.join(', ')}`,
        correlation_id,
      });
    }

    metricsStore.recordRequest('protect', {
      identifier_type: identifier.identifier_type,
      issuer_country: identifier.issuer_country,
    });

    const normResult = normalize(identifier.identifier_type, identifier.raw_value, identifier.issuer_country);
    if (!normResult.valid) {
      return res.status(400).json({
        status: 'error',
        error_code: 'FORMAT_ERROR',
        message: normResult.error,
        correlation_id,
      });
    }

    const { identifier_hmac, key_version } = generateIdentifierHmac(
      identifier.identifier_type, identifier.issuer_country, normResult.normalized
    );
    const masked_value = generateMaskedValue(normResult.normalized);
    const fingerprint = generateFingerprint(
      identifier.identifier_type, identifier.issuer_country, normResult.normalized
    );

    const claim = {
      claim_id: `ivs-${uuidv4()}`,
      claim_type: 'IDENTIFIER_PROTECTED_ONLY',
      verification_status: 'protected_only',
      identifier_type: identifier.identifier_type,
      identifier_hmac,
      identifier_hmac_key_version: key_version,
      masked_value,
      fingerprint,
      issuer_country: identifier.issuer_country,
      protected_at: new Date().toISOString(),
      protected_by: config.ivsInstanceId,
      normalization_version: 'v1',
      policy_version: 'v1',
      correlation_id,
    };

    const signedClaim = signClaim(claim);

    auditLog('CLAIM_ISSUED_PROTECTED_ONLY', {
      correlation_id,
      identifier_type: identifier.identifier_type,
      masked_value,
      claim_id: signedClaim.claim_id,
    });

    const responseTimeMs = Date.now() - startTime;
    metricsStore.recordResponseTime(responseTimeMs);
    metricsStore.recordResult('protected_only', {
      correlation_id,
      identifier_type: identifier.identifier_type,
      issuer_country: identifier.issuer_country,
      masked_value,
      response_time_ms: responseTimeMs,
    });

    return res.json({
      status: 'success',
      claim: signedClaim,
      correlation_id,
      response_time_ms: responseTimeMs,
    });

  } catch (err) {
    return res.status(500).json({
      status: 'error',
      error_code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      correlation_id: req.body?.correlation_id,
    });
  }
});

module.exports = router;
