const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Sign a verification claim using the signing key.
 * Returns the claim with an embedded signature.
 */
function signClaim(claim) {
  const payload = { ...claim };
  delete payload.signature;

  const signature = jwt.sign(payload, config.signing.key, {
    algorithm: config.signing.algorithm,
    noTimestamp: true,
  });

  return {
    ...claim,
    signature,
    signature_key_version: config.signing.keyVersion,
  };
}

/**
 * Verify a claim signature.
 */
function verifyClaim(claim) {
  try {
    const { signature } = claim;
    if (!signature) return { valid: false, reason: 'no_signature' };

    jwt.verify(signature, config.signing.key, {
      algorithms: [config.signing.algorithm],
    });
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

module.exports = { signClaim, verifyClaim };
