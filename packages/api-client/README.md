# @medirus/api-client

Typed TypeScript client for the [Medirus](https://medirus.online) API — generated from the committed OpenAPI 3.1 spec (`api/openapi.json`).

## Install

```bash
# As a workspace/file dep
npm install @medirus/api-client@file:packages/api-client
```

## Usage

```ts
import { MedirusClient, isPaymentRequired } from '@medirus/api-client';
import type { paths, operations } from '@medirus/api-client/schema';

const client = new MedirusClient({
  baseUrl: 'https://medirus.online',
  sessionCookie: process.env.X_SESSION_COOKIE,   // for /api/viral, /api/crm, ...
  bearerToken: process.env.JWT,                  // for /api/auth, /api/user, ...
  x402Payment: process.env.X402_PAYMENT_HEADER,  // for /api/ai/*
});

// Typed call — method names come from operationId (post_api_viral_mine → postApiViralMine)
const res = await client.postApiViralMine({
  body: { platform: 'x', niche: 'saas', count: 500 },
});
if (res.ok) {
  console.log(res.data);   // T from the op's response schema
} else if (isPaymentRequired(res)) {
  // x402 PaymentRequired — NOT the canonical envelope
  console.log(res.error.accepts);
} else {
  console.error(res.error.code, res.error.message);
}
```

## Auth schemes

| Constructor opt | Header | Used by |
|-----------------|--------|---------|
| `bearerToken` | `Authorization: Bearer <jwt>` | User-facing routes (/api/auth, /api/user, ...) |
| `sessionCookie` | `x-session-cookie: <auth_token>` | Pilot mounts (/api/viral, /api/crm, /api/optimizer, /api/checkpoints, /api/session) |
| `x402Payment` | `X-PAYMENT: <signed payload>` | Paid /api/ai/* endpoints |
| `a2aApiKey` | `X-Agent-API-Key: <key>` | A2A/admin routes |
| `apiKey` | `X-API-Key: <key>` | Alternate A2A header |

## Regenerating

```bash
npm run build:openapi         # refresh api/openapi.json from generateSpec()
npm run generate:api-client   # regenerate schema.d.ts + method stubs
npm run generate:api-client -- --force   # also rewrite package.json/tsconfig/README
```

The generator is deterministic — same `openapi.json` produces byte-identical output.
