const express = require('express');
const { apiKeyAuth } = require('../auth/middleware');
const { verifyClaim } = require('../crypto/signing');
const config = require('../config');

const router = express.Router();

/**
 * POST /api/v1/claims/verify
 * Allow CVG or other trusted parties to verify a claim signature.
 */
router.post('/verify', apiKeyAuth, (req, res) => {
  const { claim } = req.body;

  if (!claim || !claim.signature) {
    return res.status(400).json({
      status: 'error',
      error_code: 'BAD_REQUEST',
      message: 'Request body must include a claim object with a signature field',
    });
  }

  const result = verifyClaim(claim);

  if (result.valid) {
    return res.json({
      status: 'ok',
      signature_valid: true,
      claim_id: claim.claim_id,
      verification_status: claim.verification_status,
      signature_key_version: claim.signature_key_version,
    });
  }

  return res.status(400).json({
    status: 'error',
    signature_valid: false,
    reason: result.reason,
    claim_id: claim.claim_id,
  });
});

/**
 * GET /api/v1/claims/signing-info
 * Expose signing metadata so CVG can configure its verification.
 * Does NOT expose the key itself — only algorithm and version.
 */
router.get('/signing-info', apiKeyAuth, (_req, res) => {
  res.json({
    algorithm: config.signing.algorithm,
    key_version: config.signing.keyVersion,
    issuer: config.ivsInstanceId,
  });
});

module.exports = router;
