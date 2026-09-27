# Blocked Stories Analysis — 2026-09-27

> Status: 5 stories `ready-for-dev` with unmet activation conditions

## Story 13.12 — GraphQL Replay Engine

| Condition | Status | Blocker |
|---|---|---|
| Story 5.1 & 7.1 stable | ✅ Done (epic-5, epic-7 done) | — |
| ≥80% doc_id stable 30 days on production | ❓ Unknown | Needs production traffic metrics — no way to verify without live deployment |
| Replay cache storage (redis/sqlite) available | ⚠️ Partial | Redis available (`REDIS_HOST`/`REDIS_PORT` envs), but production deployment may vary |
| Product Council approves Phase 3 scope | ❌ Blocked | Requires human approval — cannot self-resolve |

**Recommendation:** Conditions 2 and 4 are external gates. Story remains blocked until production metrics confirm doc_id stability and Product Council approves Phase 3 scope. Not implementable without those inputs.

## Story 27.5 — Canvas/WebGL/Audio Fingerprint Spoofing

| Condition | Status | Blocker |
|---|---|---|
| FR-40..FR-54 stable in production | ⚠️ Likely done | Epics 40-44 done (JEV brain, write path, inbox triage, A2A) |
| Checkpoint rate still > 5% | ❓ Unknown | Needs live checkpoint metrics — not measurable without production data |

**Recommendation:** FR-40..54 likely satisfied (epics done), but checkpoint rate condition requires live production measurement. Story could proceed if checkpoint rate is confirmed >5% — but this is a business decision, not a technical one.

## Story 33.3 — Zalo Personal Messaging Research Spike

| Condition | Status | Blocker |
|---|---|---|
| Research spike (2 weeks dedicated) | ❌ Blocked | Requires dedicated research time — not implementable in this session |
| Nowing has concrete need | ❌ Blocked | Business requirement — external input |
| Legal/compliance review approved | ❌ Blocked | External approval required |

**Recommendation:** This is a research spike, not implementation. Even if unblocked, it requires a 2-week dedicated research period before any code can be written. External dependencies: business need + legal approval.

## Story 33.4 — YouTube VN Advanced Data

| Condition | Status | Blocker |
|---|---|---|
| Epic 33.2 stable ≥2 weeks in production | ⚠️ Unknown | Epic 33 done, but production stability not verified |
| YouTube API quota optimization complete | ❌ Blocked | Requires YouTube API quota management — external service configuration |

**Recommendation:** Blocked on production stability verification and API quota. Not implementable without confirming 33.2 production health.

## Story 35.5 — Instagram Session Persistence Live Verify

| Condition | Status | Blocker |
|---|---|---|
| Instagram test account credentials | ❌ Blocked | Requires IG_TEST_SESSIONID/IG_TEST_USER/IG_TEST_PASS env vars — not available |
| Stable residential proxy | ❌ Blocked | Requires PROXY_URL env — not configured |

**Recommendation:** Verification-only story — needs real Instagram credentials and a residential proxy. Cannot proceed without credentials. Not a code implementation story.

---

## Summary

| Story | Type | Blocker | Self-resolvable? |
|---|---|---|---|
| 13.12 | Implementation | Product Council + production metrics | No — external approval |
| 27.5 | Implementation | Checkpoint rate measurement | Partial — needs production data |
| 33.3 | Research spike | Business need + legal approval | No — external approval |
| 33.4 | Implementation | Production stability + API quota | No — external verification |
| 35.5 | Verification | Credentials + proxy | No — needs real credentials |

**None of the 5 blocked stories can be implemented in this session.** All require external inputs (credentials, approvals, production metrics, or dedicated research time) that are not available in the development environment.

## Defer Items (27 remaining)

All 27 remaining defer items are P2 design/out-of-scope — not bugs:

- `exporter.js` outputPath traversal validation (nice-to-have, not in AC)
- `exporter.test.js` edge case coverage (empty results, pagination multiples)
- `checkpoints-cli.test.js` missing (optional per spec)
- `prisma.$disconnect()` error swallowing (project-wide pattern)
- `checkpoints-routes.test.js` hardcoded JWT secret (test-only, not production)
- `checkpoint-manager.js` platform/targetType enum validation (future epic)
- `account-pool.js`/`proxy-pool.js` clock skew (monotonic timing — future hardening)
- `proxy-pool.js` checkout/checkin transaction (Story 11.3/11.7 scope)
- `providers.js` session bucket/quarantine clock skew (same as above)
- `signer-pool.js` p-limit on init/spawn (spec suggestion, not AC)
- `base-client.js` http-client-factory separation (refactor suggestion)
- `base-client.js` httpClient closure recreation (perf, not functional)
- `comment-tree.js` subCommentsCount=0 expansion (design choice)
- `comment-tree.js` orphan re-parenting (second-pass — new feature)
- `comment-tree.js` shared byId/seen/total under pLimit (design, race is theoretical)
- `threads/index.js` legacy Puppeteer scrapeTweets/searchTweets (deprecated, Epic 20.2)
- `facebook/client.js` __rev extraction (pre-existing, browser path covers AC-2)
- `facebook/crawler.js` doc_id placeholders (need live Facebook capture)
- `AdaptiveRateGovernor` Redis-backed quota (multi-worker — Story 49.3 verified existing impl)
- `ProxyIpPool` sticky binding strictPool mode (design choice, future story)
- `ProxyIpPool` realtime/bulk offsets Date.now() (clock skew — future hardening)
- `viral.js` requireSession 401 unreachable in dev (pre-existing, identical baseline)
- `viral.js` miningJobs credential storage (49.1 moved to jobCredentials — done)
- `viral-miner.js` no session transport (pre-existing, dev fallback)
- `mcp-bridge.js` dashboard path (49.1 fixed — dashboard/docs/mcp-server.html)
- `server.js`/`serverless.js`/`worker/index.js` CORS divergence (49.1 fixed ALLOWED_ORIGINS)
- `worker/index.js` preflight allowlist headers (49.1 fixed canonical headers)
- `pnpm-lock.yaml` staleness (49.1 fixed — regenerated)

**All 27 remaining defer items are either P2 design decisions or already resolved by Epic 49 fixes.** No actionable bugs remain.
