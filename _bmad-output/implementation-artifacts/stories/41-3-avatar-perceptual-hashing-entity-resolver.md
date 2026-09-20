---
epic: 41
story: 41.3
status: ready-for-dev
created: '2026-09-19'
updated: '2026-09-19'
baseline_commit: ace25a82
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
