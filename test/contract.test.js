/**
 * Contract tests for all CVG-facing IVS endpoints.
 *
 * These tests lock the exact response shapes that CVG depends on.
 * Run with: node --test test/contract.test.js
 *
 * No external dependencies — uses Node 20 built-in test runner + assert.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Set deterministic env BEFORE loading any app module
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // let OS pick a free port
process.env.HMAC_KEY = 'test-hmac-key-base64-aaaaaaaaaa==';
process.env.HMAC_KEY_VERSION = 'v1';
process.env.SIGNING_KEY = 'test-signing-key-base64-bbbbbbbbb==';
process.env.SIGNING_KEY_VERSION = 'v1';
process.env.API_KEYS = 'test-api-key';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin';
process.env.IVS_INSTANCE_ID = 'IVS-TEST-01';
process.env.NIU_API_URL = 'https://mock.test/api/kyc/verify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let baseUrl;
let server;

/** Small helper — fire an HTTP request and return { status, body }. */
function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const merged = {
      'Content-Type': 'application/json',
      'X-API-Key': 'test-api-key',
      ...headers,
    };
    // Remove headers explicitly set to empty/null/undefined
    for (const [k, v] of Object.entries(merged)) {
      if (v == null || v === '') delete merged[k];
    }
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: merged,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Claim field assertions — these are the fields CVG depends on.
// ---------------------------------------------------------------------------

/** Assert that a verified claim has all required fields with correct types. */
function assertVerifiedClaimShape(claim) {
  // Required fields
  assert.ok(claim.claim_id, 'claim_id must be present');
  assert.match(claim.claim_id, /^ivs-/, 'claim_id must start with ivs-');
  assert.equal(typeof claim.claim_type, 'string');
  assert.equal(typeof claim.verification_status, 'string');
  assert.equal(typeof claim.identifier_type, 'string');
  assert.equal(typeof claim.identifier_hmac, 'string');
  assert.equal(typeof claim.identifier_hmac_key_version, 'string');
  assert.equal(typeof claim.masked_value, 'string');
  assert.equal(typeof claim.fingerprint, 'string');
  assert.equal(typeof claim.issuer_country, 'string');
  assert.equal(typeof claim.source_registry, 'string');
  assert.equal(typeof claim.verified_at, 'string');
  assert.equal(typeof claim.verified_by, 'string');
  assert.equal(typeof claim.normalization_version, 'string');
  assert.equal(typeof claim.policy_version, 'string');
  assert.equal(typeof claim.correlation_id, 'string');
  assert.equal(typeof claim.signature, 'string');
  assert.equal(typeof claim.signature_key_version, 'string');
}

function assertProtectedOnlyClaimShape(claim) {
  assert.ok(claim.claim_id);
  assert.match(claim.claim_id, /^ivs-/);
  assert.equal(claim.claim_type, 'IDENTIFIER_PROTECTED_ONLY');
  assert.equal(claim.verification_status, 'protected_only');
  assert.equal(typeof claim.identifier_type, 'string');
  assert.equal(typeof claim.identifier_hmac, 'string');
  assert.equal(typeof claim.identifier_hmac_key_version, 'string');
  assert.equal(typeof claim.masked_value, 'string');
  assert.equal(typeof claim.fingerprint, 'string');
  assert.equal(typeof claim.issuer_country, 'string');
  assert.equal(typeof claim.protected_at, 'string');
  assert.equal(typeof claim.protected_by, 'string');
  assert.equal(typeof claim.normalization_version, 'string');
  assert.equal(typeof claim.policy_version, 'string');
  assert.equal(typeof claim.correlation_id, 'string');
  assert.equal(typeof claim.signature, 'string');
  assert.equal(typeof claim.signature_key_version, 'string');
}

function assertSuccessEnvelope(body) {
  assert.equal(body.status, 'success');
  assert.ok(body.claim, 'claim must be present');
  assert.equal(typeof body.correlation_id, 'string');
  assert.equal(typeof body.response_time_ms, 'number');
}

function assertErrorEnvelope(body) {
  assert.equal(body.status, 'error');
  assert.equal(typeof body.error_code, 'string');
  assert.equal(typeof body.message, 'string');
}

// ---------------------------------------------------------------------------
// Mock the NIU connector so tests don't call the real registry.
// We swap out the verify() method on the singleton instance.
// ---------------------------------------------------------------------------

const connectorRegistry = require('../src/connectors/registry');

/** Install a mock that returns the given result from connector.verify(). */
function mockNiuConnector(result) {
  const connector = connectorRegistry.getConnector('NIU', 'CG');
  connector._originalVerify = connector._originalVerify || connector.verify;
  connector.verify = async () => result;
}

function restoreNiuConnector() {
  const connector = connectorRegistry.getConnector('NIU', 'CG');
  if (connector._originalVerify) {
    connector.verify = connector._originalVerify;
    delete connector._originalVerify;
  }
}

// ---------------------------------------------------------------------------
// Boot the app on a random port
// ---------------------------------------------------------------------------

before(async () => {
  // Patch app.listen to capture the server and port
  const app = require('../src/index');

  // The app already called listen() on import. We need the server reference.
  // Express stores the server internally — we grab it from the connections.
  // Alternative: the module exports the app, so we create our own server.
  // Since index.js already called listen(), connections are on config.port.
  // But PORT=0, so the OS picked a port — we need to find it.

  // Try to get the server from the _server property or re-listen.
  // Actually, index.js does `app.listen(...)` which returns a server but
  // doesn't export it. We'll create a new server instance on a new port.

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  restoreNiuConnector();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ========================================================================
// 1. POST /api/v1/identifiers/verify — verified NIU
// ========================================================================
describe('POST /api/v1/identifiers/verify', () => {
  const VERIFY_PATH = '/api/v1/identifiers/verify';

  const validRequest = {
    correlation_id: 'test-corr-001',
    identifier: {
      identifier_type: 'NIU',
      raw_value: 'P24000000544639E',
      issuer_country: 'CG',
    },
    source_context: {
      gateway_id: 'CVG-CTI-01',
      requesting_assujetti_id: 'BGFI',
    },
  };

  describe('verified NIU', () => {
    beforeEach(() => {
      mockNiuConnector({
        status: 'verified',
        confirmed_attributes: {
          first_name: 'ALEXIS ABDALA',
          last_name: 'EMEDI',
          full_name: 'ALEXIS ABDALA EMEDI',
          date_of_birth: '1995-05-08',
          sex: 'M',
          nationality: 'CONGOLAISE',
          place_of_birth: 'BRAZZAVILLE',
        },
        source_registry: 'NIU',
      });
    });

    it('returns success envelope with all required fields', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, validRequest);
      assert.equal(status, 200);
      assertSuccessEnvelope(body);
    });

    it('claim has IDENTIFIER_VERIFIED type and verified status', async () => {
      const { body } = await request('POST', VERIFY_PATH, validRequest);
      assert.equal(body.claim.claim_type, 'IDENTIFIER_VERIFIED');
      assert.equal(body.claim.verification_status, 'verified');
    });

    it('claim includes confirmed_attributes with normalized demographics', async () => {
      const { body } = await request('POST', VERIFY_PATH, validRequest);
      const attrs = body.claim.confirmed_attributes;
      assert.ok(attrs, 'confirmed_attributes must be present for verified claims');
      assert.equal(typeof attrs.first_name, 'string');
      assert.equal(typeof attrs.last_name, 'string');
      assert.equal(typeof attrs.full_name, 'string');
      assert.equal(typeof attrs.date_of_birth, 'string');
      assert.match(attrs.date_of_birth, /^\d{4}-\d{2}-\d{2}$/,
        'date_of_birth must be ISO YYYY-MM-DD');
      assert.equal(typeof attrs.sex, 'string');
    });

    it('claim has HMAC, mask, fingerprint, and signature', async () => {
      const { body } = await request('POST', VERIFY_PATH, validRequest);
      assertVerifiedClaimShape(body.claim);
      // Mask shows last 4 chars
      assert.ok(body.claim.masked_value.endsWith('639E'));
      assert.ok(body.claim.masked_value.startsWith('*'));
      // Fingerprint is 16 hex chars
      assert.match(body.claim.fingerprint, /^[0-9a-f]{16}$/);
    });

    it('claim signature can be verified via /api/v1/claims/verify', async () => {
      const { body: verifyBody } = await request('POST', VERIFY_PATH, validRequest);
      const { status, body } = await request('POST', '/api/v1/claims/verify', {
        claim: verifyBody.claim,
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.signature_valid, true);
    });
  });

  // ======================================================================
  // 2. Invalid-format NIU
  // ======================================================================
  describe('invalid-format NIU', () => {
    beforeEach(() => restoreNiuConnector());

    it('returns 400 with FORMAT_ERROR for non-alphanumeric NIU', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        ...validRequest,
        identifier: {
          identifier_type: 'NIU',
          raw_value: 'INVALID!@#$%',
          issuer_country: 'CG',
        },
      });
      assert.equal(status, 400);
      assertErrorEnvelope(body);
      assert.equal(body.error_code, 'FORMAT_ERROR');
      assert.equal(typeof body.correlation_id, 'string');
    });

    it('returns 400 with FORMAT_ERROR for too-short NIU', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        ...validRequest,
        identifier: {
          identifier_type: 'NIU',
          raw_value: 'AB12',
          issuer_country: 'CG',
        },
      });
      assert.equal(status, 400);
      assert.equal(body.error_code, 'FORMAT_ERROR');
    });
  });

  // ======================================================================
  // 3. NIU not found
  // ======================================================================
  describe('NIU not found', () => {
    beforeEach(() => {
      mockNiuConnector({
        status: 'not_found',
        message: 'No information available',
        source_registry: 'NIU',
      });
    });

    it('returns success envelope with not_found status in claim', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, validRequest);
      assert.equal(status, 200);
      assertSuccessEnvelope(body);
      assert.equal(body.claim.verification_status, 'not_found');
      assert.equal(body.claim.claim_type, 'IDENTIFIER_CHECK_RESULT');
    });

    it('not_found claim still has HMAC, mask, fingerprint, signature', async () => {
      const { body } = await request('POST', VERIFY_PATH, validRequest);
      assertVerifiedClaimShape(body.claim);
    });

    it('not_found claim includes registry_message', async () => {
      const { body } = await request('POST', VERIFY_PATH, validRequest);
      assert.equal(typeof body.claim.registry_message, 'string');
    });
  });

  // ======================================================================
  // 4. NIU registry unavailable
  // ======================================================================
  describe('NIU registry unavailable', () => {
    beforeEach(() => {
      mockNiuConnector({
        status: 'registry_unavailable',
        message: 'NIU registry returned server error',
        source_registry: 'NIU',
      });
    });

    it('returns success envelope with registry_unavailable status', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, validRequest);
      assert.equal(status, 200);
      assertSuccessEnvelope(body);
      assert.equal(body.claim.verification_status, 'registry_unavailable');
    });
  });

  // ======================================================================
  // 5. Protect-only fallback (no connector, allow_protection_without_registry)
  // ======================================================================
  describe('protect-only fallback', () => {
    it('returns protected_only claim for unsupported type with fallback flag', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        correlation_id: 'test-corr-fallback',
        identifier: {
          identifier_type: 'PASSPORT',
          raw_value: 'AB1234567',
          issuer_country: 'FR',
        },
        options: { allow_protection_without_registry: true },
      });
      assert.equal(status, 200);
      assertSuccessEnvelope(body);
      assertProtectedOnlyClaimShape(body.claim);
    });

    it('returns NO_CONNECTOR error without fallback flag', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        correlation_id: 'test-corr-no-fallback',
        identifier: {
          identifier_type: 'PASSPORT',
          raw_value: 'AB1234567',
          issuer_country: 'FR',
        },
      });
      assert.equal(status, 422);
      assertErrorEnvelope(body);
      assert.equal(body.error_code, 'NO_CONNECTOR');
    });
  });

  // ======================================================================
  // 6. Bad request — missing fields
  // ======================================================================
  describe('bad request', () => {
    it('returns BAD_REQUEST when correlation_id is missing', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        identifier: validRequest.identifier,
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'BAD_REQUEST');
    });

    it('returns BAD_REQUEST when identifier is missing', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        correlation_id: 'test',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'BAD_REQUEST');
    });

    it('returns UNSUPPORTED_TYPE for unknown identifier type', async () => {
      const { status, body } = await request('POST', VERIFY_PATH, {
        correlation_id: 'test',
        identifier: {
          identifier_type: 'UNKNOWN',
          raw_value: 'test',
          issuer_country: 'CG',
        },
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'UNSUPPORTED_TYPE');
    });
  });
});

// ========================================================================
// POST /api/v1/identifiers/protect
// ========================================================================
describe('POST /api/v1/identifiers/protect', () => {
  const PROTECT_PATH = '/api/v1/identifiers/protect';

  it('returns protected_only claim for valid identifier', async () => {
    const { status, body } = await request('POST', PROTECT_PATH, {
      correlation_id: 'test-protect-001',
      identifier: {
        identifier_type: 'NIU',
        raw_value: 'P24000000544639E',
        issuer_country: 'CG',
      },
    });
    assert.equal(status, 200);
    assertSuccessEnvelope(body);
    assertProtectedOnlyClaimShape(body.claim);
    assert.equal(body.claim.identifier_type, 'NIU');
    assert.equal(body.claim.issuer_country, 'CG');
  });

  it('returns FORMAT_ERROR for invalid identifier', async () => {
    const { status, body } = await request('POST', PROTECT_PATH, {
      correlation_id: 'test-protect-bad',
      identifier: {
        identifier_type: 'NIU',
        raw_value: '!!!',
        issuer_country: 'CG',
      },
    });
    assert.equal(status, 400);
    assert.equal(body.error_code, 'FORMAT_ERROR');
  });
});

// ========================================================================
// POST /api/v1/claims/verify
// ========================================================================
describe('POST /api/v1/claims/verify', () => {
  const CLAIMS_PATH = '/api/v1/claims/verify';

  it('returns signature_valid: true for a valid claim', async () => {
    // First, get a real signed claim via protect
    const { body: protectBody } = await request('POST', '/api/v1/identifiers/protect', {
      correlation_id: 'test-claim-verify',
      identifier: {
        identifier_type: 'NIU',
        raw_value: 'P24000000544639E',
        issuer_country: 'CG',
      },
    });

    const { status, body } = await request('POST', CLAIMS_PATH, {
      claim: protectBody.claim,
    });

    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.signature_valid, true);
    assert.equal(body.claim_id, protectBody.claim.claim_id);
    assert.equal(body.verification_status, protectBody.claim.verification_status);
    assert.equal(body.signature_key_version, protectBody.claim.signature_key_version);
  });

  it('returns signature_valid: false for a tampered claim', async () => {
    const { body: protectBody } = await request('POST', '/api/v1/identifiers/protect', {
      correlation_id: 'test-claim-tamper',
      identifier: {
        identifier_type: 'NIU',
        raw_value: 'P24000000544639E',
        issuer_country: 'CG',
      },
    });

    // Tamper with the signature
    const tamperedClaim = {
      ...protectBody.claim,
      signature: protectBody.claim.signature + 'TAMPERED',
    };

    const { status, body } = await request('POST', CLAIMS_PATH, {
      claim: tamperedClaim,
    });

    assert.equal(status, 400);
    assert.equal(body.status, 'error');
    assert.equal(body.signature_valid, false);
    assert.equal(typeof body.reason, 'string');
  });

  it('returns 400 when claim has no signature', async () => {
    const { status, body } = await request('POST', CLAIMS_PATH, {
      claim: { claim_id: 'test' },
    });
    assert.equal(status, 400);
    assert.equal(body.error_code, 'BAD_REQUEST');
  });

  it('returns 400 when body has no claim', async () => {
    const { status, body } = await request('POST', CLAIMS_PATH, {});
    assert.equal(status, 400);
    assert.equal(body.error_code, 'BAD_REQUEST');
  });
});

// ========================================================================
// GET /api/v1/claims/signing-info
// ========================================================================
describe('GET /api/v1/claims/signing-info', () => {
  it('returns algorithm, key_version, and issuer', async () => {
    const { status, body } = await request('GET', '/api/v1/claims/signing-info');
    assert.equal(status, 200);
    assert.equal(body.algorithm, 'HS512');
    assert.equal(typeof body.key_version, 'string');
    assert.equal(typeof body.issuer, 'string');
  });
});

// ========================================================================
// GET /api/v1/health
// ========================================================================
describe('GET /api/v1/health', () => {
  it('returns healthy status with required fields', async () => {
    // Health endpoint is public — omit API key header
    const { status, body } = await request('GET', '/api/v1/health', null, {
      'X-API-Key': '',
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'healthy');
    assert.equal(body.service, 'MTN IVS');
    assert.equal(typeof body.instance, 'string');
    assert.equal(typeof body.timestamp, 'string');
    assert.equal(typeof body.version, 'string');
  });
});

// ========================================================================
// Normalization unit tests (no HTTP, just the function)
// ========================================================================
describe('Normalization', () => {
  const { normalize } = require('../src/normalization/normalizer');

  it('normalizes alphanumeric NIU P24000000544639E', () => {
    const result = normalize('NIU', 'P24000000544639E', 'CG');
    assert.equal(result.valid, true);
    assert.equal(result.normalized, 'P24000000544639E');
  });

  it('strips spaces and dashes from NIU', () => {
    const result = normalize('NIU', 'P24 000-000 544639E', 'CG');
    assert.equal(result.valid, true);
    assert.equal(result.normalized, 'P24000000544639E');
  });

  it('uppercases NIU', () => {
    const result = normalize('NIU', 'p24000000544639e', 'CG');
    assert.equal(result.valid, true);
    assert.equal(result.normalized, 'P24000000544639E');
  });

  it('rejects NIU with special characters', () => {
    const result = normalize('NIU', 'P240@#$!000', 'CG');
    assert.equal(result.valid, false);
    assert.equal(result.error, 'NIU must be alphanumeric');
  });

  it('rejects NIU shorter than 8 chars', () => {
    const result = normalize('NIU', 'P24', 'CG');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('outside valid range'));
  });
});

// ========================================================================
// NIU attribute normalization unit tests
// ========================================================================
describe('NIU _normalizeAttributes', () => {
  const NiuConnector = require('../src/connectors/niu');
  const niu = new NiuConnector();

  it('maps French field names to canonical schema', () => {
    const attrs = niu._normalizeAttributes({
      prenom: 'Alexis Abdala',
      nom: 'Emedi',
      dateOfBirth: '1995-05-08',
      sexe: 'MASCULIN',
      nationalite: 'Congolaise',
      lieuNaissance: 'Brazzaville',
    });
    assert.equal(attrs.first_name, 'ALEXIS ABDALA');
    assert.equal(attrs.last_name, 'EMEDI');
    assert.equal(attrs.full_name, 'ALEXIS ABDALA EMEDI');
    assert.equal(attrs.date_of_birth, '1995-05-08');
    assert.equal(attrs.sex, 'M');
    assert.equal(attrs.nationality, 'CONGOLAISE');
    assert.equal(attrs.place_of_birth, 'BRAZZAVILLE');
  });

  it('maps English field names', () => {
    const attrs = niu._normalizeAttributes({
      givenNames: 'John',
      surnames: 'Doe',
      dateOfBirth: '1990-01-15',
      sex: 'MALE',
      nationality: 'CONGOLAISE',
      placeOfBirth: 'Pointe-Noire',
    });
    assert.equal(attrs.first_name, 'JOHN');
    assert.equal(attrs.last_name, 'DOE');
    assert.equal(attrs.full_name, 'JOHN DOE');
    assert.equal(attrs.sex, 'M');
  });

  it('normalizes DD/MM/YYYY date format', () => {
    const attrs = niu._normalizeAttributes({
      givenNames: 'Test',
      dateOfBirth: '08/05/1995',
    });
    assert.equal(attrs.date_of_birth, '1995-05-08');
  });

  it('normalizes datetime with space separator', () => {
    const attrs = niu._normalizeAttributes({
      givenNames: 'Test',
      dateOfBirth: '1995-05-08 00:00:00',
    });
    assert.equal(attrs.date_of_birth, '1995-05-08');
  });

  it('normalizes YYYYMMDD date format', () => {
    const attrs = niu._normalizeAttributes({
      givenNames: 'Test',
      dateOfBirth: '19950508',
    });
    assert.equal(attrs.date_of_birth, '1995-05-08');
  });

  it('normalizes FEMININ to F', () => {
    const attrs = niu._normalizeAttributes({ sexe: 'FEMININ' });
    assert.equal(attrs.sex, 'F');
  });

  it('handles null/undefined data gracefully', () => {
    assert.deepStrictEqual(niu._normalizeAttributes(null), {});
    assert.deepStrictEqual(niu._normalizeAttributes(undefined), {});
    assert.deepStrictEqual(niu._normalizeAttributes('string'), {});
  });
});

// ========================================================================
// HMAC determinism
// ========================================================================
describe('HMAC determinism', () => {
  const { generateIdentifierHmac, generateMaskedValue, generateFingerprint } = require('../src/crypto/hmac');

  it('same input always produces same HMAC', () => {
    const a = generateIdentifierHmac('NIU', 'CG', 'P24000000544639E');
    const b = generateIdentifierHmac('NIU', 'CG', 'P24000000544639E');
    assert.equal(a.identifier_hmac, b.identifier_hmac);
    assert.equal(a.key_version, b.key_version);
  });

  it('different inputs produce different HMACs', () => {
    const a = generateIdentifierHmac('NIU', 'CG', 'P24000000544639E');
    const b = generateIdentifierHmac('NIU', 'CG', 'DIFFERENT12345678');
    assert.notEqual(a.identifier_hmac, b.identifier_hmac);
  });

  it('masked value shows last 4 chars only', () => {
    const masked = generateMaskedValue('P24000000544639E');
    assert.equal(masked, '************639E');
  });

  it('fingerprint is 16 hex characters', () => {
    const fp = generateFingerprint('NIU', 'CG', 'P24000000544639E');
    assert.match(fp, /^[0-9a-f]{16}$/);
  });
});
