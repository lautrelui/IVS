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

  niu: {
    apiUrl: process.env.NIU_API_URL || 'https://api.egovwallet.com/api/kyc/verify',
    apiTimeout: parseInt(process.env.NIU_API_TIMEOUT || '10000', 10),
  },

  ivsInstanceId: process.env.IVS_INSTANCE_ID || 'IVS-MTN-01',
  trustedGateways: (process.env.TRUSTED_GATEWAYS || 'CVG-CTI-01').split(',').map(g => g.trim()),
};

module.exports = config;
