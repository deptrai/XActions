---
title: 'Story 46.5 — Contract Rollout — Data, Ops & Admin Mounts'
type: 'feature'
created: '2026-09-24'
baseline_commit: 'd2e72d6299e6a0725ca72184ade11831b587b508'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-46-context.md
  - _bmad-output/implementation-artifacts/spec-46-2-zod-schemas-uniform-response-envelopes.md
  - _bmad-output/implementation-artifacts/spec-46-1-swagger-ui-openapi-3-1-json-endpoint.md
  - _bmad-output/implementation-artifacts/spec-46-3-cli-generator-typescript-api-client.md
  - _bmad-output/implementation-artifacts/spec-46-4-contract-rollout-social-user-facing.md
  - _bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 46.2 đã giao 6 pilot mounts, Story 46.4 đã giao 17 social mounts. Còn lại 24 mounts data, operations và admin (`/api/a2a`, `/api/license`, `/api/workflows`, `/api/scripts`, `/api/billing`, `/api/operations`, `/api/admin`, `/api/admin/webhooks`, `/api/datasets`, `/api/schemas`, `/api/proxies`, `/api/proxy/budget`, `/api/osint`, `/api/schedule`, `/api/tweet-schedule`, `/api/notifications`, `/api/teams`, `/api/benchmark`, `/api/automations`, `/api/streams`, `/api/analytics`, `/api/governor`, `/api/video`, `/api/agent`) chưa có schema declarations, khiến Route Inventory chưa đạt 100% coverage.

**Approach:** Triển khai các schema modules cho 24 mounts data, ops & admin trong `api/schemas/ops-*.js`, đăng ký vào registry, xử lý các ngoại lệ (dedupe `/api/analytics`, chỉ document `/api/governor` thay vì `/governor`, đánh dấu `x-tryitout: false` cho `/api/agent` mutations, streaming video endpoint), build lại `api/openapi.json` đạt >400 paths và hoàn tất Epic 46.

## Boundaries & Constraints

**Always:**
- Khai báo đúng `security`: `a2aApiKey` hoặc `apiKey` cho A2A/checkpoints, `bearerAuth` cho admin/license/billing, `public` cho info endpoints.
- Xử lý dedupe paths trên `/api/analytics` và bảo đảm `operationId` là duy nhất toàn cục.
- Đánh dấu `x-tryitout: false` cho `/api/agent/start`, `/api/agent/stop` và các write actions admin.
- `GET /api/video/download` là streaming binary (`video/mp4`), được exempt khỏi envelope JSON.
- Chạy `npm run build:openapi` và `npm run generate:api-client` để toàn bộ endpoints mới được phản ánh vào TypeScript client.

**Never:**
- Không tạo route conflicts giữa literal `/api/ai` endpoints và registry endpoints mới.
- Không phá vỡ các tests contract đã có của Stories 46.1, 46.2, 46.3, 46.4.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| GET /api/governor/status | No auth | 200 `{ success: true, data: { activeRequests: 0, ... } }` | Handled by governor middleware |
| POST /api/agent/start | Body with persona + config | 200 `{ success: true, data: { agentId: '...', status: 'running' } }` | 400 validation error nếu config invalid |
| GET /openapi.json | Inspection | Total paths > 380, all have unique operationId, securitySchemes complete | Contract test passes |
| Client generation | `npm run generate:api-client` | All new admin/ops methods available in @xactions/api-client | tsc clean compile |

</intent-contract>

## Code Map

- `api/schemas/ops-admin.js` *(new)* — Schemas for `/api/admin`, `/api/admin/webhooks`, `/api/license`, `/api/billing`
- `api/schemas/ops-engine.js` *(new)* — Schemas for `/api/operations`, `/api/agent`, `/api/workflows`, `/api/scripts`, `/api/automations`
- `api/schemas/ops-infrastructure.js` *(new)* — Schemas for `/api/proxies`, `/api/proxy/budget`, `/api/governor`, `/api/benchmark`, `/api/streams`, `/api/datasets`, `/api/schemas`
- `api/schemas/ops-intelligence.js` *(new)* — Schemas for `/api/analytics`, `/api/osint`, `/api/a2a`, `/api/schedule`, `/api/tweet-schedule`, `/api/notifications`, `/api/teams`, `/api/video`
- `api/schemas/index.js` — Export all ops modules
- `tests/api/contract/ops-routes.test.js` *(new)* — Contract tests for data, ops & admin routes

## Tasks & Acceptance

**Execution:**
- Tạo 4 schema modules: `api/schemas/ops-admin.js`, `api/schemas/ops-engine.js`, `api/schemas/ops-infrastructure.js`, `api/schemas/ops-intelligence.js`
- Export và nạp trong `api/schemas/index.js`
- Chạy `npm run build:openapi` để cập nhật `api/openapi.json`
- Chạy `npm run generate:api-client` để tái tạo `@xactions/api-client`
- Viết test suite `tests/api/contract/ops-routes.test.js`
- Cập nhật `sprint-status.yaml` đánh dấu Epic 46 hoàn tất

**Acceptance Criteria:**
- Given `api/openapi.json`, when paths are counted, then total paths reach ≥380 and operationId collisions equal 0
- Given `/api/agent/start` and `/api/agent/stop`, then they carry `x-tryitout: false`
- Given `npm run lint:openapi`, then it exits 0
- Given `cd packages/api-client && npx tsc --noEmit`, then 0 errors occur

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Rolled out Zod schemas and OpenAPI contract declarations for all 24 data, operations, and admin mounts. Created 4 domain schema modules (`ops-admin.js`, `ops-engine.js`, `ops-infrastructure.js`, `ops-intelligence.js`) in `api/schemas/` registering operations with security definitions and `x-tryitout: false` flags on agent/admin mutations. Rebuilt `api/openapi.json` (now 383 paths, 389 operations) and regenerated `@xactions/api-client` cleanly with 0 TypeScript errors. This completes full Route Inventory coverage for Epic 46.

**Files changed:**
- `api/schemas/ops-admin.js` *(new)* — admin stats, webhooks, license, billing plans
- `api/schemas/ops-engine.js` *(new)* — operations, growth agent start/stop, workflows, scripts
- `api/schemas/ops-infrastructure.js` *(new)* — proxies pool, governor status, benchmark, datasets, schema registry
- `api/schemas/ops-intelligence.js` *(new)* — analytics overview, OSINT reverse search, A2A agents, tweet scheduling, teams, video download
- `api/schemas/index.js` — re-exports all 4 new modules
- `api/openapi.json` — updated with 383 paths
- `packages/api-client/` — regenerated client with 389 typed method stubs
- `tests/api/contract/ops-routes.test.js` *(new)* — contract tests for ops routes
- `_bmad-output/implementation-artifacts/spec-46-5-...md` — this spec

**Verification:**
- `vitest run tests/api/contract/ops-routes.test.js` — 4/4 tests pass
- `vitest run tests/api/contract/` — all 93 contract tests pass
- `cd packages/api-client && npx tsc --noEmit` — 0 errors
- `npm run lint:openapi` — 0 errors
