---
epic: 41
story: 41.3
status: done
review_loop_iteration: 0
followup_review_recommended: false
deferred:
  - summary: >-
      WebP avatar decode not supported — detectFormat handles PNG/JPEG/GIF only;
      WebP avatars silently fall back to URL-equality.
    evidence: >-
      AC-1 Given lists WebP but AC-2 and Out-of-Scope restrict to PNG/JPEG/GIF —
      spec-internal ambiguity. WebP needs a heavier dep (sharp/@jsquash) which
      violates the zero/light-dep NFR-15; documented as a module limitation.
    location: >-
      src/osint/image-decode.js:detectFormat
    severity: low
created: '2026-09-19'
updated: '2026-09-20'
baseline_commit: ca15f47654e2aaf66fcafef09cf43bb48b4e53cf
---

# Story 41.3: Avatar Perceptual Hashing — `phash.js` + `EntityResolver` async avatar signal

## Epic
Epic 41: OSINT Enhancement — Developer Registries & Entity Resolution

## Goal
Nâng cấp `EntityResolver` `avatar_match` signal từ URL-string-equality sang perceptual hashing, để nhận diện và gom cụm avatar cross-platform khi URL ảnh từ CDN khác nhau.

## FRs Covered
- FR-109 (Avatar Perceptual Hashing for Entity Resolution)

## NFRs Covered
- NFR-21 (Option D — no PII/hash persistence, in-memory per-request only)
- NFR-20 (Zero mocks; unit test <1.5s, no network in tests)
- NFR-15 (Clean architecture — pure JS module, zero-dep preferred)

## Story

As an XActions OSINT consumer,
I want `EntityResolver` to match avatars by image content (not just URL),
So that the same person's avatar served from different CDNs (fbcdn, cdninstagram, githubavatars) still clusters correctly.

## Background / Problem

Hiện tại `src/mcp/entity-resolver.js` (~line 179-184):
```js
const aAv = norm(a.avatar);
const bAv = norm(b.avatar);
if (aAv && bAv && aAv === bAv) signals.push('avatar_match');  // +30
```
Chỉ match khi `avatar` URL string **giống hệt nhau**. Thực tế cùng 1 ảnh:
- Facebook: `https://scontent.fsgn5-6.fna.fbcdn.net/v/t39.30808-1/...`
- Instagram: `https://scontent.cdninstagram.com/v/t51.2885-19/...`
- GitHub: `https://avatars.githubusercontent.com/u/123?v=4`

→ URL khác nhau → `avatar_match` miss → cluster không merge dù cùng ảnh thật.

## Acceptance Criteria

### AC-1: `phash.js` module (pure JS)
**Given** raw image bytes (JPEG/PNG/GIF/WebP) decoded to RGBA
**When** `computeDHash(rgba, width, height)` / `computeAHash(rgba, width, height)` is called
**Then** it returns a 64-bit BigInt hash
**And** `hammingDistance(hashA, hashB)` returns integer 0–64

### AC-2: Image decode path
**Given** an avatar URL (http/https)
**When** `fetchAvatarHash(url, options)` is called
**Then** it fetches bytes via injected `httpClient`/`undici` (timeout ≤ 3s)
**And** decodes to RGBA (PNG/JPEG/GIF via minimal decoder or a single light dep e.g. `upng-js`/`jpeg-js`)
**And** returns `{ hash, algorithm, width, height }` or `null` on decode/network failure (never throws)

### AC-3: EntityResolver avatar_match upgrade (⚠️ breaking signature change)
**Given** two `ProfileItem`s with non-equal avatar URLs
**When** `resolveIdentities(profiles)` runs the avatar signal
**Then** it **pre-fetches** avatar pHashes for ALL unique avatar URLs in the profile set in one `Promise.allSettled` batch (O(n) fetches — NOT O(n²) inside the pairwise loop)
**And** `scorePair` / `resolveIdentities` become **`async`** (pHash fetch is network I/O)
**And** pushes `avatar_match` (+30) when `hammingDistance ≤ AVATAR_PHASH_THRESHOLD` (default 10)
**And** keeps URL-exact equality as fast-path (no fetch when URLs already equal)
**And** returns `identityClusters[]` merge identical to current contract

**Signature change required:**
- `resolveIdentities(profiles)` at `entity-resolver.js:226` → `async resolveIdentities(profiles)`.
- `scorePair(a, b)` at `entity-resolver.js:161` → `async scorePair(a, b)` (or keep sync by pre-resolving a `Map<url,hash>` and passing it in — preferred: keeps pairwise loop sync, only the prefetch step is async).
- Caller `osint-find-profiles.js:653` → change `const identityClusters = resolveIdentities(profiles, query)` → `const identityClusters = await resolveIdentities(profiles, query)` (the enclosing fn is already async — verify).
- Any other sync caller of `resolveIdentities`/`scorePair` must be migrated or the API kept dual-mode.

### AC-4: Backward compatibility & Option D
**Given** existing `profiles[]`/`platformStatus[]` output
**When** avatar URLs are equal OR pHash unavailable (decode fail/offline)
**Then** URL-equality fast-path still yields `avatar_match`
**And** no hash or avatar content is persisted to Prisma/disk (in-memory only)

### AC-5: Config & threshold
**Given** env var `OSINT_AVATAR_PHASH_THRESHOLD` or options
**When** set to a Hamming threshold (0–64)
**Then** resolver uses it; default = 10
**And** `OSINT_AVATAR_PHASH=0` disables fetch path entirely (URL-equality only)

### AC-6: Tests (real, no mocks)
**Given** fixture images (same photo re-encoded / resized / different CDN filename)
**When** `vitest run tests/osint/phash.test.js` executes
**Then** identical-content avatars produce Hamming ≤ threshold across different files
**And** different photos produce Hamming > threshold
**And** decode-failure returns `null` gracefully (no throw)
**And** unit tests complete <1.5s without network (fixtures on disk)

## Files to Create/Modify
- `src/osint/phash.js` — new (dHash/aHash + hammingDistance + fetchAvatarHash)
- `src/osint/image-decode.js` — new (minimal PNG/JPEG/GIF → RGBA) OR single dep
- `src/mcp/entity-resolver.js` — async avatar signal, fast-path URL-equality
- `src/mcp/osint-find-profiles.js` — pass avatar phash options through
- `tests/osint/phash.test.js` — new
- `tests/osint/fixtures/` — same-photo-across-formats + distinct photos
- `docs/architecture.md` — AD-46 already added

## Out of Scope
- pHash/PII persistence (Option D)
- Video/GIF-frame hashing beyond first frame
- Native image libs (sharp) — keep zero/light dep
- Changing `profiles[]`/`platformStatus[]` shape

## Open Questions
- OQ-1: Image decode — pure-JS minimal PNG decoder vs single light dep (`upng-js`+`jpeg-js`)? → Prefer aHash/dHash which only need RGBA; pick smallest dep or hand-rolled decoder. Resolve during dev.
- OQ-2: aHash vs dHash default? → dHash generally more robust to resize; default dHash, expose both.

## Dev Notes
- **Preferred design:** keep `scorePair`/`resolveIdentities` SYNC and add an `async prefetchAvatarHashes(profiles)` step that returns `Map<avatarUrl, hash>`; `scorePair` reads the map for the pHash branch. This avoids turning the O(n²) pairwise loop async and keeps the signature backward-compatible for the non-avatar signals. Only the top-level `resolveIdentities` entry becomes `async` to run the prefetch.
- If `resolveIdentities` must become async, update `osint-find-profiles.js:653` to `await` and grep for other callers (`tgrep resolveIdentities`) before committing.
- Avatar fetch: parallel via `Promise.allSettled`, ≤3s timeout each, dedupe by URL before fetching (same URL may appear on multiple profiles).
- On fetch/decode failure → `null` hash → treat as "no avatar_match" (URL-exact still applies); never throw.
- Keep `profiles[]`/`platformStatus[]` shape unchanged (backward compat, Option D no-persist).
- Reference retro: `epic-41-retrospective.md` Action Item #1.

## Review Triage Log

### 2026-09-20 — Review pass
- verdicts: 19 findings — high 0, medium 3, low 9, false 5, maybe-false 1 (plus 4 descriptive intent-alignment notes folded in)
- findings:
  - `[medium]` `[patch]` pHash resolver path untested end-to-end (Intent+VeriGap+Blind) — added 6 tests to `entity-resolver.test.js`: `scorePair`/`resolveIdentities` with populated `avatarHashMap`, `prefetchAvatarHashes` dedup + disabled + non-array.
  - `[medium]` `[patch]` Raw `timeoutMs` passed to per-avatar fetch; `0`/huge values bypass the ≤3s bound (Intent+VeriGap+Edge+Blind) — `osint-find-profiles.js:654` now passes clamped `callerTimeout`; `prefetchAvatarHashes` caps each fetch at 3000ms.
  - `[medium]` `[patch]` Unbounded avatar-fetch concurrency + no response-size cap (Blind) — `p-limit` (existing dep) caps at 8 concurrent; `fetchAvatarHash` rejects >5MB payloads.
  - `[low]` `[patch]` `norm()` lowercases URL before fetch — breaks case-sensitive signed CDN URLs (Edge) — fetch raw URL, key map by normalized form.
  - `[low]` `[patch]` `isAvatarPHashEnabled`/`getAvatarPHashThreshold` re-read env inside O(n²) pair loop (Blind) — resolved once in `resolveIdentities`, passed as explicit args to `scorePair`.
  - `[low]` `[patch]` `prefetchAvatarHashes` threw TypeError on non-array input (Edge) — `Array.isArray` guard.
  - `[low]` `[patch]` `decodeGif` used frame rect, not logical screen → cropped hash on optimized GIFs (Blind) — uses `reader.width/height` full buffer.
  - `[low]` `[patch]` Test made a real external `undici.fetch` to `cdn.example.com` violating NFR-20 no-network (Intent+Blind) — switched to unroutable `127.0.0.1:1`.
  - `[low]` `[patch]` `OSINT_AVATAR_PHASH*` env vars missing from `.env.example` (Blind) — added documented block.
  - `[low]` `[patch]` Mid-file `import` at entity-resolver.js:76 (Blind) — hoisted to top with other imports.
  - `[false]` `[reject]` "prefetch fetches identical URLs, defeating fast-path" (Edge claim) — `urlByNorm` dedupes; same URL fetches once, and the map is needed to compare that URL against *other* URLs. Fast-path semantics (skip pHash compare when equal) still hold.
  - `[false]` `[reject]` `avatar_phash` distinct signal for auditability (Blind) — renaming/adding a second signal alters the downstream `matchedSignals` contract; cosmetic gain vs contract churn.
  - `[false]` `[reject]` `canonical-action-matrix` regeneration riding along (Blind+Intent) — auto-generated file correctly reflecting 13.11's `optionalArgs`; committing it is correct, not contamination.
  - `[false]` `[reject]` Injected `httpClient` not checking `resp.ok` (Blind) — injected-client contract is a test seam; decode-failure on a 404 HTML body already returns null gracefully.
  - `[maybe-false]` `[defer]` WebP decode absent (Intent+Edge+Blind) — spec-internal ambiguity (AC-1 vs AC-2/Out-of-Scope); recorded in `deferred`.
  - `[low]` `[reject]` Dead alpha guard `rgba[idx+3] !== undefined` (Blind) — defensive dead code, removal is cosmetic churn.
  - `[low]` `[reject]` Double full-image pass in `resizeToGrayscale` (Blind) — perf note only, no named harm.

## Auto Run Result

**Summary.** Story 41.3 completed: `avatar_match` signal upgraded from URL-string-equality to perceptual hashing. New `src/osint/phash.js` (dHash/aHash → 64-bit BigInt, `hammingDistance`, `fetchAvatarHash` with ≤3s timeout + 5MB cap + concurrency-limited prefetch) and `src/osint/image-decode.js` (PNG/JPEG/GIF → RGBA via `pngjs`/`jpeg-js`/`omggif`). `EntityResolver` gained `prefetchAvatarHashes` (async, O(n) `Promise.allSettled`) while `scorePair`/`resolveIdentities` stayed **sync** — the preferred design that avoids a breaking signature change. Caller `osint-find-profiles.js:654` awaits prefetch then resolves.

**Files changed.**
- `src/osint/phash.js` — new; hash primitives + fetch + env config.
- `src/osint/image-decode.js` — new; PNG/JPEG/GIF → RGBA (WebP documented as unsupported).
- `src/mcp/entity-resolver.js` — `avatarHashMap` param on `scorePair`/`resolveIdentities`, `prefetchAvatarHashes`, hoisted env config, raw-URL fetch.
- `src/mcp/osint-find-profiles.js` — `await prefetchAvatarHashes` with clamped timeout.
- `tests/osint/phash.test.js` + `tests/osint/fixtures/` — new; 21 tests, 6 fixture images.
- `tests/mcp/entity-resolver.test.js` — +6 resolver-level pHash tests.
- `package.json` — `pngjs`, `jpeg-js`, `omggif` (pure-JS, light per NFR-15).
- `.env.example` — `OSINT_AVATAR_PHASH` / `OSINT_AVATAR_PHASH_THRESHOLD` documented.
- `docs/canonical-action-matrix.*` — regenerated (carries Story 13.11 `optionalArgs`).

**Review findings.** 19 findings → 10 patched (3 medium, 7 low), 5 rejected false/refuted, 1 deferred (WebP), rest descriptive.

**Verification performed.** `vitest run tests/osint tests/mcp/entity-resolver.test.js tests/mcp/osint-find-profiles.test.js` → **72/72 pass**; unit `phash.test.js` <1.5s no-network. Full-suite spot-check: 5292 pass, 1 pre-existing unrelated failure (`admin-retention.test.js` Prisma unique constraint — reproduced on baseline).

**Residual risks.** WebP avatars fall back to URL-equality (deferred). GraphQL/PII boundary honored — all processing in-memory per-request (Option D).

**Follow-up review recommended:** false — patched entries are low/medium with direct test coverage; no unverified high-severity change.
