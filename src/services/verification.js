const { v4: uuidv4 } = require('uuid');
const { normalize } = require('../normalization/normalizer');
const { generateIdentifierHmac, generateMaskedValue, generateFingerprint } = require('../crypto/hmac');
const { signClaim } = require('../crypto/signing');
const { auditLog } = require('../audit/logger');
const connectorRegistry = require('../connectors/registry');
const config = require('../config');

/**
 * Core verification service.
 * Implements the full verify flow: normalize -> route -> call registry -> protect -> sign claim.
 */
async function verifyIdentifier(request) {
  const startTime = Date.now();
  const { correlation_id, identifier, source_context, options } = request;
  const { identifier_type, raw_value, issuer_country } = identifier;

  // Audit: request received
  auditLog('VERIFY_REQUEST_RECEIVED', {
    correlation_id,
    identifier_type,
    issuer_country,
    gateway_id: source_context?.gateway_id,
    requesting_assujetti_id: source_context?.requesting_assujetti_id,
  });

  // Step 1: Normalize
  const normResult = normalize(identifier_type, raw_value, issuer_country);

  auditLog('IDENTIFIER_NORMALIZED', {
    correlation_id,
    identifier_type,
    issuer_country,
    valid: normResult.valid,
    error: normResult.error,
  });

  if (!normResult.valid) {
    auditLog('VERIFY_REJECTED_INVALID_FORMAT', {
      correlation_id,
      identifier_type,
      issuer_country,
      error: normResult.error,
    });
    return {
      status: 'error',
      error_code: 'FORMAT_ERROR',
      message: normResult.error,
      correlation_id,
      response_time_ms: Date.now() - startTime,
    };
  }

  // Step 2: Check connector availability
  const connector = connectorRegistry.getConnector(identifier_type, issuer_country);

  if (!connector) {
    if (options?.allow_protection_without_registry) {
      return protectOnly(identifier_type, normResult.normalized, issuer_country, correlation_id, startTime);
    }
    return {
      status: 'error',
      error_code: 'NO_CONNECTOR',
      message: `No registry connector available for ${identifier_type} in ${issuer_country}`,
      correlation_id,
      response_time_ms: Date.now() - startTime,
    };
  }

  // Step 3: Call registry
  auditLog('CONNECTOR_CALL_STARTED', {
    correlation_id,
    identifier_type,
    connector_name: connector.name,
  });

  const connectorResult = await connector.verify(normResult.normalized, issuer_country, correlation_id);

  if (connectorResult.status === 'verified') {
    auditLog('CONNECTOR_CALL_SUCCEEDED', {
      correlation_id,
      identifier_type,
      connector_name: connector.name,
      status: connectorResult.status,
    });
  } else {
    auditLog('CONNECTOR_CALL_FAILED', {
      correlation_id,
      identifier_type,
      connector_name: connector.name,
      status: connectorResult.status,
      message: connectorResult.message,
    });
  }

  // Step 4: Generate protected representation
  const { identifier_hmac, key_version } = generateIdentifierHmac(identifier_type, issuer_country, normResult.normalized);
  const masked_value = generateMaskedValue(normResult.normalized);
  const fingerprint = generateFingerprint(identifier_type, issuer_country, normResult.normalized);

  // Step 5: Build and sign claim
  const claim = {
    claim_id: `ivs-${uuidv4()}`,
    claim_type: connectorResult.status === 'verified' ? 'IDENTIFIER_VERIFIED' : 'IDENTIFIER_CHECK_RESULT',
    verification_status: connectorResult.status,
    identifier_type,
    identifier_hmac,
    identifier_hmac_key_version: key_version,
    masked_value,
    fingerprint,
    issuer_country,
    source_registry: connectorResult.source_registry || connector.name,
    verified_at: new Date().toISOString(),
    verified_by: config.ivsInstanceId,
    normalization_version: 'v1',
    policy_version: 'v1',
    correlation_id,
  };

  if (options?.return_confirmed_attributes && connectorResult.confirmed_attributes) {
    claim.confirmed_attributes = connectorResult.confirmed_attributes;
  }

  if (connectorResult.message) {
    claim.registry_message = connectorResult.message;
  }

  const signedClaim = signClaim(claim);

  // Audit: claim issued
  const auditEventType = connectorResult.status === 'verified'
    ? 'CLAIM_ISSUED_VERIFIED'
    : connectorResult.status === 'not_found'
      ? 'VERIFY_RESULT_NOT_FOUND'
      : connectorResult.status === 'inconclusive'
        ? 'VERIFY_RESULT_INCONCLUSIVE'
        : 'CLAIM_ISSUED_VERIFIED';

  auditLog(auditEventType, {
    correlation_id,
    identifier_type,
    masked_value,
    verification_status: connectorResult.status,
    claim_id: signedClaim.claim_id,
  });

  return {
    status: 'success',
    claim: signedClaim,
    correlation_id,
    response_time_ms: Date.now() - startTime,
  };
}

function protectOnly(identifierType, normalizedValue, issuerCountry, correlationId, startTime) {
  const { identifier_hmac, key_version } = generateIdentifierHmac(identifierType, issuerCountry, normalizedValue);
  const masked_value = generateMaskedValue(normalizedValue);
  const fingerprint = generateFingerprint(identifierType, issuerCountry, normalizedValue);

  const claim = {
    claim_id: `ivs-${uuidv4()}`,
    claim_type: 'IDENTIFIER_PROTECTED_ONLY',
    verification_status: 'protected_only',
    identifier_type: identifierType,
    identifier_hmac,
    identifier_hmac_key_version: key_version,
    masked_value,
    fingerprint,
    issuer_country: issuerCountry,
    protected_at: new Date().toISOString(),
    protected_by: config.ivsInstanceId,
    normalization_version: 'v1',
    policy_version: 'v1',
    correlation_id: correlationId,
  };

  const signedClaim = signClaim(claim);

  auditLog('CLAIM_ISSUED_PROTECTED_ONLY', {
    correlation_id: correlationId,
    identifier_type: identifierType,
    masked_value,
    claim_id: signedClaim.claim_id,
  });

  return {
    status: 'success',
    claim: signedClaim,
    correlation_id: correlationId,
    response_time_ms: Date.now() - startTime,
  };
}

module.exports = { verifyIdentifier, protectOnly };
