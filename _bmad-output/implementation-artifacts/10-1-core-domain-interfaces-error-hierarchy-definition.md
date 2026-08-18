# Story 10.1 — Core Domain Interfaces & Error Hierarchy Definition

**Story ID:** 10.1  
**Epic:** 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces  
**Status:** done  
**Owner:** DEV  
**Source:** `epics.md` Story 10.1, `prd.md` FR-64, `ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-9, AD-11, AD-14, AD-15

---

## Story Statement

As a **Core Developer**,  
I want **to define abstract classes `AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore` and a standard error hierarchy (`PlatformError`, `RateLimitError`, `AuthSessionExpiredError`, `ProxyDeadError`)**,  
So that **every platform crawler and adapter in the future has a consistent, idiomatic architecture and automatically classifies retryable errors**.

---

## Acceptance Criteria (with verification notes)

### AC-1: Dependencies present
* **Given** `package.json`
* **When** checking `dependencies`
* **Then** `got-scraping`, `qrcode-terminal`, `socks-proxy-agent`, and `undici` are present or confirmed available
* **Verification:** `got-scraping@3.2.15`, `qrcode-terminal@0.12.0`, `socks-proxy-agent@8.0.5` và `undici@6.21.2` đều có trong `package.json`. `undici.ProxyAgent` có sẵn để subclass sử dụng khi cần.

### AC-2: `src/core/` is 100% Pure ESM, zero runtime npm dependencies
* **Given** the `src/core/` directory
* **When** scanning imports
* **Then** no runtime `import` from `node_modules` is present (JSDoc type imports are acceptable)
* **Verification:** Confirmed. All runtime imports are intra-package (`./error-envelope.js`, `./action-registry.js`, etc.). No external package is imported at runtime in `src/core/`.

### AC-3: Core module files exist
* **Given** `src/core/`
* **When** listing modules
* **Then** these files exist: `base-crawler.js`, `base-client.js`, `base-login.js`, `base-store.js`, `error-envelope.js`, `signer-pool.js`, `status-api.js`, `session-manager.js`, `adaptive-governor.js`, `index.js`, `action-registry.js`, `account-pool.js`, `platform-validator.js`, `types.js`
* **Verification:** Confirmed via `find_file_by_name`.

### AC-4: Abstract class contracts
* **Given** each abstract class
* **When** instantiated directly
* **Then** it throws a `TypeError` or equivalent abstract-class error
* **And** all abstract methods throw `Error('Method not implemented: ...')` or similar

| Class | Abstract Methods |
|---|---|
| `AbstractCrawler` | `init()`, `search(args)`, `getPostDetail(args)`, `getComments(args)`, `cleanup()` |
| `AbstractApiClient` | `init(session)`, `request(method, url, options)`, `sign(payload)` |
| `AbstractStore` | `init()`, `storeContent(post)`, `storeBatch(posts)`, `storeComment(comment)`, `storeCommentBatch(comments)`, `close()` |
| `AbstractLogin` | `login()`, `refresh()`, `isAuthenticated()` |
| `AbstractPlatformResponseValidator` | `isValidPayload(response)`, `isBotChallenge(response)`, `isRateLimit(response)` |

* **Note:** `AbstractCrawler.start(command)` is implemented as a **concrete template-method dispatcher** in `src/core/base-crawler.js`. It validates the command, looks up the registered action, and invokes the handler. This is required by AC-5 and is the intended contract, not an abstract `Error`-throwing stub.

* **Verification:** All abstract classes guard `new.target === AbstractXxx`, all abstract methods throw `Error('Method not implemented: ...')`, and `AbstractCrawler.start()` dispatches registered actions. ✅

### AC-5: `AbstractCrawler` action registry, category validation, snake_case enforcement
* **Given** a subclassed crawler
* **When** calling `registerAction(action, handler, descriptor)`
* **Then** `action` must be `snake_case` (`^[a-z0-9_]+$`)
* **And** the action is registered in the crawler's local registry and the global `ActionRegistry`
* **And** `listActions()` returns `ActionDescriptor[]` with `{ action, description, requiredArgs, optionalArgs, example, outputType }`
* **And** `start({ action, args, session })` looks up and invokes the handler
* **And** items are validated for `id`, `platform`, and valid `category`
* **Verification:** `registerAction` validates regex, `listActions` returns descriptors, `start` dispatches, `validateItem` checks `id`, `platform`, and `isValidCategory`. ✅

### AC-6: Error hierarchy and `toEnvelope()`
* **Given** any `PlatformError` subclass
* **When** calling `error.toEnvelope()`
* **Then** it returns `{ code, type, message, statusCode, isRetryable, retryAfterMs, retryAfter, suggestedAction, accountId?, platform }`
* **And** `PlatformError` fields are `statusCode`, `platform`, `isRetryable`, `retryAfterMs`, `suggestedAction`
* **Verification:** `error-envelope.js` defines all fields and `toEnvelope()` returns the exact shape. `isRetryable` is a getter. ✅

### AC-7: `GovernorStatusApi` shape
* **Given** `StatusApi`
* **When** calling `getGovernorStatus()`
* **Then** it returns `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`
* **Verification:** `src/core/status-api.js` returns the exact shape (default values when no governor). ✅

### AC-8: `node src/core/index.js` parses and `npx prisma validate` passes
* **Given** the repo
* **When** running `node src/core/index.js` and `npx prisma validate`
* **Then** both exit with code 0
* **Verification:** Ran `node src/core/index.js` → exit 0. Ran `npx prisma validate` → `The schema at prisma/schema.prisma is valid 🚀`. ✅

---

## Developer Context

### Existing Implementation

`src/core/` has already been scaffolded and partially implemented. The DEV agent should **treat this as an existing codebase to be verified and completed**, not a greenfield module.

**Files already in place:**

- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/index.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/base-crawler.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/base-client.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/base-login.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/base-store.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/error-envelope.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/action-registry.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/session-manager.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/account-pool.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/status-api.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/adaptive-governor.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/platform-validator.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/signer-pool.js" />
- <ref_file file="/Users/luisphan/Documents/GitHub/XActions/src/core/types.js" />

### What must be preserved

- `src/core/` **must remain zero-runtime-dependency** (pure ESM, no `node_modules` imports).
- Existing `AbstractCrawler` `start()` contract uses `CrawlerCommand` shape `{ action, args, session }`.
- `AbstractApiClient` constructor accepts `{ sessionManager, proxyPool, accountPool, governor }`.
- `PlatformError.toEnvelope()` shape is consumed by `src/mcp/server.js` and `src/api/**` endpoints.

### Known gaps / review items

1. **`undici` dependency:** `package.json` does not list `undici`. The AC requires it to be present or confirmed available. Since Node 18+ has `fetch` via undici, but `undici.ProxyAgent` is not directly importable without the package. Decide in `dev-story` whether to add `undici` to `dependencies` or rely on `got-scraping` proxy handling.
2. **`base-client.js` `handleError`:** Currently throws `PlatformError` but does not wire `governor.recordRequest()` or `PlatformResponseValidator`. That is the responsibility of **Story 11.5**, not 10.1.
3. **`AbstractStore` throws `Error` not `PlatformError`:** Consistent with abstract methods, but ensure subclasses override.
4. **`base-crawler.js` constructor signature:** It currently takes `deps = { client, store, sessionManager }`, not the full `CrawlerCommand`. Subclass constructors must handle wiring.

### Architecture compliance

- **AD-2** — `src/core/base-crawler.js`, `src/core/base-client.js`, `src/core/base-login.js`, `src/core/base-store.js` define the contracts. All platform implementations live in `src/scrapers/{domain}/{platform}/`.
- **AD-11** — `AbstractCrawler` registers `snake_case` actions and exposes `listActions()`.
- **AD-14** — `PlatformError.toEnvelope()` and `StatusApi.getGovernorStatus()` provide operational observability.
- **AD-15** — `AbstractLogin` supports QR/CDP/cookie flows, returning `{ accountId, cookies, tokens, expiresAt }`.

### Testing requirements

- Add unit tests under `tests/core/` or `tests/http-scraper/`:
  - `AbstractCrawler` throws when instantiated directly.
  - `AbstractCrawler.registerAction` rejects non-snake_case action names.
  - `PlatformError` subclasses produce correct `toEnvelope()`.
  - `StatusApi.getGovernorStatus()` returns expected shape.
  - `node src/core/index.js` parses without errors.

### Type & license conventions

- Use JSDoc types (`/** @type ... */` and `/** @typedef */`).
- File header: `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.`
- ESM only (`import`/`export`), no `require`.

---

## Implementation Notes

1. If the existing files already satisfy all ACs, the DEV agent may skip code changes and focus on:
   - adding `tests/core/` tests,
   - resolving the `undici` dependency decision,
   - tightening any JSDoc/typing inconsistencies.
2. If any AC fails during `dev-story`, fix only the failing contract; do not implement platform-specific logic here (that belongs to Epics 13–18).

---

## Completion Criteria

- [x] All ACs verified against existing `src/core/` implementation.
- [x] `undici` dependency added to `package.json` (`^6.21.2`, Node 18 compatible).
- [x] Core unit tests added and passing (`vitest run tests/core/index.test.js` = 24 passed).
- [x] `npx prisma validate` passes.
- [x] `node src/core/index.js` exits with code 0.
