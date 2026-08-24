const crypto = require('crypto');

function generateSecureDefault(label) {
  return crypto.randomBytes(48).toString('base64');
}

const config = {
  port: parseInt(process.env.PORT || '3011', 10),
  nodeEnv: process.env.NODE_ENV || 'production',

  auth: {
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',
    jwtSecret: process.env.JWT_SECRET || generateSecureDefault('jwt'),
    sessionMaxAge: 8 * 60 * 60 * 1000, // 8 hours
  },

  apiKeys: (process.env.API_KEYS || 'cvg-api-key-change-me').split(',').map(k => k.trim()),

  hmac: {
    key: process.env.HMAC_KEY || generateSecureDefault('hmac'),
    keyVersion: process.env.HMAC_KEY_VERSION || 'v1',
    algorithm: 'sha256',
  },

  signing: {
    key: process.env.SIGNING_KEY || generateSecureDefault('signing'),
    keyVersion: process.env.SIGNING_KEY_VERSION || 'v1',
    algorithm: 'HS512',
  },

  // External NIU registry.
  //
  // Fail-closed: there is deliberately no built-in registry URL. An unset
  // NIU_API_URL must never silently select a public government endpoint, so
  // external NIU verification is only available when an operator supplies an
  // explicit provider URL. /api/v1/identifiers/protect is unaffected — it
  // never contacts a registry.
  niu: {
    apiUrl: process.env.NIU_API_URL || null,
    apiTimeout: parseInt(process.env.NIU_API_TIMEOUT || '30000', 10),
    get externalLookupEnabled() {
      return Boolean(this.apiUrl);
    },
  },

  ivsInstanceId: process.env.IVS_INSTANCE_ID || 'IVS-MTN-01',
  trustedGateways: (process.env.TRUSTED_GATEWAYS || 'CVG-CTI-01').split(',').map(g => g.trim()),
};

module.exports = config;
