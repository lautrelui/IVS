/**
 * Fail-closed external NIU egress tests.
 *
 * Pins three properties for the staging-safe deployment mode:
 *   1. /api/v1/identifiers/protect works with no registry URL configured.
 *   2. The verify path refuses external lookup when no explicit provider URL
 *      is set — and issues no HTTP request while doing so.
 *   3. No hardcoded public registry (api.egovwallet.com) is ever silently
 *      selected.
 *
 * No external dependencies: winston is stubbed through the module loader so
 * these run with `node --test` against a bare checkout.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PUBLIC_REGISTRY_HOST = 'api.egovwallet.com';
const SRC = path.join(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// Stub winston so src/audit/logger.js loads without node_modules present.
// ---------------------------------------------------------------------------
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
const passthroughFormat = () => ({});
passthroughFormat.combine = () => ({});
passthroughFormat.timestamp = () => ({});
passthroughFormat.json = () => ({});
passthroughFormat.colorize = () => ({});
passthroughFormat.simple = () => ({});

const winstonStub = {
  createLogger: () => noopLogger,
  format: passthroughFormat,
  transports: { Console: class Console {} },
};

const originalLoad = Module._load;
before(() => {
  Module._load = function (request, ...rest) {
    if (request === 'winston') return winstonStub;
    return originalLoad.call(this, request, ...rest);
  };
});
after(() => {
  Module._load = originalLoad;
});

/** Load a fresh copy of a src module with the current process.env. */
function freshRequire(relPath) {
  const resolved = require.resolve(path.join(SRC, relPath));
  delete require.cache[resolved];
  delete require.cache[require.resolve(path.join(SRC, 'config.js'))];
  return require(resolved);
}

// ---------------------------------------------------------------------------
// 1. No hardcoded public registry
// ---------------------------------------------------------------------------
describe('no hardcoded public registry', () => {
  beforeEach(() => {
    delete process.env.NIU_API_URL;
  });

  it('config exposes a null NIU url when NIU_API_URL is unset', () => {
    const config = freshRequire('config.js');
    assert.equal(config.niu.apiUrl, null);
    assert.equal(config.niu.externalLookupEnabled, false);
  });

  it('never resolves to the public eGov endpoint by default', () => {
    const config = freshRequire('config.js');
    assert.ok(
      !JSON.stringify(config).includes(PUBLIC_REGISTRY_HOST),
      'resolved config must not contain the public registry host'
    );
  });

  it('carries no public registry literal in config source', () => {
    const source = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
    const codeOnly = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !codeOnly.includes(PUBLIC_REGISTRY_HOST),
      'config.js must not hardcode the public registry host'
    );
  });

  it('honours an explicitly supplied provider URL', () => {
    process.env.NIU_API_URL = 'https://registry.internal.example/api/kyc/verify';
    const config = freshRequire('config.js');
    assert.equal(config.niu.apiUrl, 'https://registry.internal.example/api/kyc/verify');
    assert.equal(config.niu.externalLookupEnabled, true);
    delete process.env.NIU_API_URL;
  });
});

// ---------------------------------------------------------------------------
// 2. Verify path refuses external lookup with no provider URL
// ---------------------------------------------------------------------------
describe('NIU connector fail-closed behaviour', () => {
  let originalFetch;

  beforeEach(() => {
    delete process.env.NIU_API_URL;
    originalFetch = globalThis.fetch;
  });

  function withFetchSpy(fn) {
    let calls = 0;
    globalThis.fetch = async (...args) => {
      calls += 1;
      throw new Error(`unexpected outbound request: ${args[0]}`);
    };
    try {
      return fn(() => calls);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('reports external lookup as disabled', () => {
    const NiuConnector = freshRequire('connectors/niu.js');
    assert.equal(new NiuConnector().isExternalLookupEnabled(), false);
  });

  it('returns registry_unavailable without issuing any HTTP request', async () => {
    const NiuConnector = freshRequire('connectors/niu.js');
    const connector = new NiuConnector();

    const result = await withFetchSpy(async (callCount) => {
      const r = await connector.verify('1234567890123', 'CG', 'corr-1');
      assert.equal(callCount(), 0, 'fetch must not be called');
      return r;
    });

    assert.equal(result.status, 'registry_unavailable');
    assert.notEqual(result.status, 'verified');
    assert.equal(result.external_lookup_enabled, false);
    assert.match(result.message, /NIU_API_URL/);
    assert.equal(result.confirmed_attributes, undefined);
  });

  it('is deterministic across repeated calls', async () => {
    const NiuConnector = freshRequire('connectors/niu.js');
    const connector = new NiuConnector();

    const first = await connector.verify('1234567890123', 'CG', 'corr-a');
    const second = await connector.verify('1234567890123', 'CG', 'corr-b');

    assert.deepEqual(
      { status: first.status, message: first.message },
      { status: second.status, message: second.message }
    );
  });

  it('surfaces the disabled state on the health check', async () => {
    const NiuConnector = freshRequire('connectors/niu.js');
    const health = await new NiuConnector().healthCheck();
    assert.equal(health.external_lookup_enabled, false);
  });
});

// ---------------------------------------------------------------------------
// 3. Protect path needs no registry egress
// ---------------------------------------------------------------------------
describe('protect path without registry egress', () => {
  beforeEach(() => {
    delete process.env.NIU_API_URL;
    process.env.HMAC_KEY = 'test-hmac-key-for-protect-path-aaaaaaaa';
    process.env.HMAC_KEY_VERSION = 'v1';
    process.env.IVS_INSTANCE_ID = 'IVS-TEST-01';
  });

  it('protect route source references no registry connector', () => {
    const source = fs.readFileSync(path.join(SRC, 'routes', 'protect.js'), 'utf8');
    assert.ok(!source.includes('connectors'), 'protect route must not load a connector');
    assert.ok(!source.includes('niu.apiUrl'), 'protect route must not read a registry URL');
    assert.ok(!source.includes(PUBLIC_REGISTRY_HOST));
  });

  it('produces protected_only artefacts with no NIU url configured', () => {
    const config = freshRequire('config.js');
    assert.equal(config.niu.apiUrl, null);

    const { generateIdentifierHmac, generateMaskedValue, generateFingerprint } =
      freshRequire('crypto/hmac.js');

    const { identifier_hmac, key_version } = generateIdentifierHmac('NIU', 'CG', '1234567890123');
    assert.ok(identifier_hmac && identifier_hmac.length > 0);
    assert.equal(key_version, 'v1');
    assert.ok(generateMaskedValue('1234567890123').length > 0);
    assert.ok(generateFingerprint('NIU', 'CG', '1234567890123').length > 0);
  });

  it('protect claims are protected_only, never VERIFIED', () => {
    const source = fs.readFileSync(path.join(SRC, 'routes', 'protect.js'), 'utf8');
    assert.ok(source.includes("verification_status: 'protected_only'"));
    assert.ok(source.includes("claim_type: 'IDENTIFIER_PROTECTED_ONLY'"));
    assert.ok(!source.includes("verification_status: 'verified'"));
  });
});
