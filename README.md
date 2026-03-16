# MTN Identifier Verification Service (IVS)

Secure service for identifier verification, normalization, protected representation generation, and signed claim issuance.

## Architecture

```
OneBox -> CVG -> MTN IVS -> Registry (NIU) -> Signed Claim -> CVG -> OneBox -> Central DIT
```

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

## Configuration

Copy `.env.example` to `.env` and set values. Key environment variables:

| Variable | Description |
|----------|-------------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Dashboard login credentials |
| `API_KEYS` | Comma-separated API keys for gateway authentication |
| `HMAC_KEY` | Base64-encoded HMAC key for identifier protection |
| `SIGNING_KEY` | Base64-encoded key for claim signing |
| `NIU_API_URL` | NIU registry endpoint |

## API Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/v1/identifiers/verify` | API Key | Verify identifier against registry |
| `POST /api/v1/identifiers/protect` | API Key | Generate protected representation only |
| `GET /api/v1/health` | None | Service health check |
| `GET /api/v1/connectors/health` | API Key / Session | Connector health status |

## Monitoring Dashboard

Access at `http://localhost:3011/dashboard` with admin credentials.

## Example Verify Request

```bash
curl -X POST http://localhost:3011/api/v1/identifiers/verify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cvg-api-key-change-me" \
  -d '{
    "correlation_id": "cvg-20260316-000771",
    "identifier": {
      "identifier_type": "NIU",
      "raw_value": "1234567890123",
      "issuer_country": "CG"
    },
    "source_context": {
      "requesting_assujetti_id": "BGFI",
      "onebox_id": "OBX-BGFI-01",
      "gateway_id": "CVG-CTI-01",
      "local_request_ref": "REQ-2026-000771",
      "purpose": "kyc_verification"
    },
    "options": {
      "return_confirmed_attributes": true,
      "allow_protection_without_registry": false
    }
  }'
```
