const crypto = require('crypto');
const config = require('../config');

/**
 * Generate a deterministic HMAC for an identifier.
 * Input format: IDENTIFIER_TYPE|ISSUER_COUNTRY|NORMALIZED_VALUE
 * This ensures different identifier types cannot collide.
 */
function generateIdentifierHmac(identifierType, issuerCountry, normalizedValue) {
  const input = `${identifierType}|${issuerCountry}|${normalizedValue}`;
  const hmac = crypto.createHmac(config.hmac.algorithm, config.hmac.key);
  hmac.update(input);
  return {
    identifier_hmac: hmac.digest('base64'),
    key_version: config.hmac.keyVersion,
  };
}

/**
 * Generate a masked value from the normalized identifier.
 * Shows only the last 4 characters.
 */
function generateMaskedValue(normalizedValue) {
  if (!normalizedValue || normalizedValue.length <= 4) {
    return '****';
  }
  const visible = normalizedValue.slice(-4);
  const masked = '*'.repeat(normalizedValue.length - 4);
  return masked + visible;
}

/**
 * Generate a short operational fingerprint (first 8 chars of SHA-256).
 */
function generateFingerprint(identifierType, issuerCountry, normalizedValue) {
  const input = `${identifierType}|${issuerCountry}|${normalizedValue}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

module.exports = { generateIdentifierHmac, generateMaskedValue, generateFingerprint };
