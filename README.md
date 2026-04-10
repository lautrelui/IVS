# MTN Identifier Verification Service (IVS)

Secure service for identifier verification, normalization, HMAC-protected representation generation, and signed claim issuance.

## Architecture

```
OneBox -> CVG -> MTN IVS -> Registry (NIU) -> Signed Claim -> CVG -> OneBox -> Central DIT
```

Raw identifiers never leave IVS. CVG receives only HMAC-protected representations and signed claims.

## Quick Start

### Docker (recommended)

```bash
docker compose up -d --build
```

The service will be available at `http://localhost:3011`.

### Local Development

```bash
npm install
npm start
```

### Run Tests

```bash
npm test
```

Runs the contract test suite (40 tests) using Node's built-in test runner. Covers all CVG-facing endpoint response shapes, normalization, attribute mapping, HMAC determinism, and claim signature verification.

## Configuration

Copy `.env.example` to `.env` and set values. Key environment variables:

| Variable | Description |
|----------|-------------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Dashboard login credentials (default: `admin`/`admin`) |
| `API_KEYS` | Comma-separated API keys for gateway authentication |
| `HMAC_KEY` | Base64-encoded HMAC key for identifier protection |
| `SIGNING_KEY` | Base64-encoded key for claim signing (HS512) |
| `NIU_API_URL` | NIU registry endpoint |
| `NIU_API_TIMEOUT` | Registry call timeout in ms (default: 10000) |
| `IVS_INSTANCE_ID` | Instance identifier in signed claims (default: `IVS-MTN-01`) |

## API Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/v1/identifiers/verify` | API Key | Verify identifier against registry, return signed claim |
| `POST /api/v1/identifiers/protect` | API Key | Generate HMAC-protected representation only (no registry call) |
| `POST /api/v1/claims/verify` | API Key | Verify signature of a previously issued claim |
| `GET /api/v1/claims/signing-info` | API Key | Signing algorithm, key version, and issuer metadata |
| `GET /api/v1/health` | None | Service health check |
| `GET /api/v1/connectors/health/connectors` | API Key / Session | Connector health details |

## Supported Identifier Types

| Type | Format | Example |
|------|--------|---------|
| `NIU` | Alphanumeric, 8-25 chars | `P24000000544639E` |
| `PASSPORT` | Alphanumeric, 5-20 chars | `AB1234567` |
| `NID` | Alphanumeric + dashes, 5-30 chars | `CG-12345678` |
| `DRIVER_LICENSE` | Alphanumeric + dashes, 5-30 chars | `DL-987654321` |

## Monitoring Dashboard

Access at `http://localhost:3011` with admin credentials. Four views: Overview, Live Requests, Connectors, Audit Log.

## OpenAPI Spec

Machine-readable API contract: [`docs/openapi.yaml`](docs/openapi.yaml)

## Example: Verify NIU

```bash
curl -X POST http://localhost:3011/api/v1/identifiers/verify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cvg-api-key-change-me" \
  -d '{
    "correlation_id": "cvg-20260316-000771",
    "identifier": {
      "identifier_type": "NIU",
      "raw_value": "P24000000544639E",
      "issuer_country": "CG"
    },
    "source_context": {
      "requesting_assujetti_id": "BGFI",
      "onebox_id": "OBX-BGFI-01",
      "gateway_id": "CVG-CTI-01",
      "local_request_ref": "REQ-2026-000771",
      "purpose": "kyc_verification"
    }
  }'
```

### Successful Response (verified)

```json
{
  "status": "success",
  "claim": {
    "claim_id": "ivs-550e8400-e29b-41d4-a716-446655440000",
    "claim_type": "IDENTIFIER_VERIFIED",
    "verification_status": "verified",
    "identifier_type": "NIU",
    "identifier_hmac": "base64-encoded-hmac",
    "identifier_hmac_key_version": "v1",
    "masked_value": "************639E",
    "fingerprint": "a1b2c3d4e5f67890",
    "issuer_country": "CG",
    "source_registry": "NIU",
    "verified_at": "2026-03-16T10:30:00.000Z",
    "verified_by": "IVS-MTN-01",
    "normalization_version": "v1",
    "policy_version": "v1",
    "correlation_id": "cvg-20260316-000771",
    "confirmed_attributes": {
      "first_name": "ALEXIS ABDALA",
      "last_name": "EMEDI",
      "full_name": "ALEXIS ABDALA EMEDI",
      "date_of_birth": "1995-05-08",
      "sex": "M",
      "nationality": "CONGOLAISE",
      "place_of_birth": "BRAZZAVILLE"
    },
    "signature": "eyJhbGciOiJIUzUxMiJ9...",
    "signature_key_version": "v1"
  },
  "correlation_id": "cvg-20260316-000771",
  "response_time_ms": 342
}
```

### Error Response (format error)

```json
{
  "status": "error",
  "error_code": "FORMAT_ERROR",
  "message": "NIU must be alphanumeric",
  "correlation_id": "cvg-20260316-000772",
  "response_time_ms": 2
}
```

## Example: Verify Claim Signature

```bash
curl -X POST http://localhost:3011/api/v1/claims/verify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cvg-api-key-change-me" \
  -d '{ "claim": { ...signed_claim_from_verify_response... } }'
```

### Valid Signature Response

```json
{
  "status": "ok",
  "signature_valid": true,
  "claim_id": "ivs-550e8400-e29b-41d4-a716-446655440000",
  "verification_status": "verified",
  "signature_key_version": "v1"
}
```
