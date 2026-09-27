# Epic 46 Retrospective — Swagger UI & OpenAPI Contract

> Date: 2026-09-27
> Scope: Stories 46.1–46.5 (5 stories, all done)
> Branch: main · tags v3.3.x
> Status: **COMPLETE**

## Story ledger

| Story | Deliverable |
|---|---|
| 46.1 Swagger UI & OpenAPI 3.1 JSON Endpoint | `GET /openapi.json` (383 paths, 5 schemes), self-hosted Swagger UI via swagger-ui-express |
| 46.2 Zod Schemas & Uniform Response Envelopes | Zod schemas for all request/response shapes, uniform `{success, data, error}` envelope across all routes |
| 46.3 CLI Generator for TypeScript API Client | `xactions api-client` command generates typed TypeScript client from OpenAPI spec |
| 46.4 Contract Rollout — Social & User-Facing Mounts | Social routes (twitter, facebook, bluesky, mastodon, threads) on uniform envelope |
| 46.5 Contract Rollout — Data, Ops & Admin Mounts | Data/ops/admin routes on uniform envelope, webhook admin endpoints |

## What worked

- Self-hosted Swagger UI avoids CDN CSP issues — swagger-ui-express bundles assets from node_modules
- Zod schemas caught several contract drift issues during rollout (response shapes differed across mounts)
- OpenAPI spec as single source of truth: `generateSpec()` regenerates per request, stays in lock-step with implementation
- 383 paths + 5 security schemes verified live

## What didn't work / friction

- Two-phase contract rollout (social first, data/ops/admin second) meant partial envelope coverage for a period — consumers saw mixed shapes
- `pnpm-lock.yaml` staleness surfaced during CI — xspace-agent version pinned to unpublished version
- Server process needed restart after each spec change during development — no hot reload for spec generation

## Metrics

- 383 OpenAPI paths
- 5 security schemes (Bearer, ApiKey, SessionCookie, x402, OAuth2)
- 93/93 contract tests passing
- Zero TypeScript errors in generated client

## Action items

- [ ] [Carried] `pnpm-lock.yaml` maintenance: regenerate on dep changes, verify `--frozen-lockfile` in CI
- [ ] [Carried] Hot-reload spec generation during development (currently requires restart)

## Verdict

**ACCEPTED** — all stories done, contract verified live (383 paths), no open items.
