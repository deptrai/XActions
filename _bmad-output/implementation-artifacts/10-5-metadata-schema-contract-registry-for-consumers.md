---
story_id: 10.5
story_key: 10-5-metadata-schema-contract-registry-for-consumers
epic: 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces
status: done
---

# 10.5 — Metadata Schema Contract & Registry for Consumers

|||
|---|---|
| **Story ID** | 10.5 |
| **Story Key** | `10-5-metadata-schema-contract-registry-for-consumers` |
| **Epic** | 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces |
| **Status** | ready-for-dev |
| **Author** | nich (@nichxbt) |

---

## User Story

**As a** Nowing Integrator / Downstream Consumer,
**I want** each platform/category to publish a JSON Schema contract for `Post.metadata` with API, CLI, and MCP discovery,
**so that** consumers know upfront what fields exist, types are standardized, and data is validated before insertion.

---

## Business & Architecture Context

- **Epic 10 Goal:** Unified PostgreSQL storage (Prisma) and foundational interfaces for multi-platform crawlers.
- **The Problem:** `Post.metadata` is stored as a PostgreSQL `Json?` column (indexed with JSONB GIN index). Without formal schemas, downstream consumers (Nowing AI Lead Hub, export utilities, reporting pipelines) have no way to know what fields exist or their types across diverse platforms (e.g. `twitter::social` vs `shopee::ecom` vs `topcv::recruitment`).
- **The Solution (AD-4 Rule 6 & NFR15):** A lightweight, zero-external-dependency schema registry in `src/core/metadata-schema-registry.js` that:
  1. Auto-discovers and registers JSON Schemas located under `schemas/<platform>/<category>.json`.
  2. Provides programmatic registration, lookup, and validation APIs.
  3. Validates `Post.metadata` in `PrismaStore` before writing (if a schema is registered for that `(platform, category)`).
  4. Publishes discovery via REST API (`GET /api/schemas`), CLI (`xactions schema list/get`), and MCP tools (`x_schema_list`, `x_schema_get`).
  5. Includes two pilot schemas: `schemas/twitter/social.json` and `schemas/shopee/ecom.json`.

---

## Acceptance Criteria

### AC1 — Metadata Schema Registry Service (`src/core/metadata-schema-registry.js`)

- **Given** JSON Schema definitions stored in `schemas/<platform>/<category>.json` or registered programmatically
- **When** calling `MetadataSchemaRegistry`:
  - `loadSchemasFromDisk(schemasDir)`: recursively discovers and registers all `.json` files in `<schemasDir>/<platform>/<category>.json`. Must use synchronous `fs` methods (`fs.readdirSync`, `fs.readFileSync`) to ensure the registry is ready on module load without race conditions. If the directory does not exist, the registry must start empty without throwing.
  - `registerSchema(platform, category, schema)`: registers a JSON schema for a specific platform and category. Schemas MUST be cached in memory (e.g., `Map<string, object>`) to ensure high-performance, zero-disk-I/O lookups.
  - `getSchema(platform, category)`: returns the registered JSON Schema object from the in-memory cache, or `null` if not found.
  - `hasSchema(platform, category)`: returns boolean indicating whether a schema is registered.
  - `listSchemas()`: returns array of schema descriptors `{ platform, category, title, description, version, propertiesCount }`.
  - `validateMetadata(platform, category, metadata)`: validates a metadata object against the registered schema. Returns `{ valid: boolean, errors: string[] }`. The validator must accumulate errors with exact JSON paths (e.g. `metadata.shopId must be integer`).
- **And** `src/core/metadata-schema-registry.js` has **zero external npm dependencies** (NFR15 Clean Architecture), using a built-in, recursive JSON Schema validator for common types (`string`, `number`, `integer`, `boolean`, `array`, `object`, `required`, `enum`, `minimum`, `maximum`, `pattern`) and nested `properties` / `items`.

### AC2 — Pilot JSON Schemas (`schemas/twitter/social.json` & `schemas/shopee/ecom.json`)

- **Given** the `schemas/` directory
- **When** inspecting pilot schemas:
  - `schemas/twitter/social.json`: defines fields for Twitter social posts:
    - `tweetId` (string, required)
    - `replyCount` (integer, >= 0)
    - `retweetCount` (integer, >= 0)
    - `likeCount` (integer, >= 0)
    - `quoteCount` (integer, >= 0)
    - `bookmarkCount` (integer, >= 0)
    - `isRetweet` (boolean)
    - `isReply` (boolean)
    - `isQuote` (boolean)
    - `hashtags` (array of strings)
    - `mentions` (array of strings)
    - `lang` (string)
    - `conversationId` (string)
  - `schemas/shopee/ecom.json`: defines fields for Shopee e-commerce products:
    - `itemId` (`oneOf`/`anyOf` `string` or `number`, required)
    - `shopId` (`oneOf`/`anyOf` `string` or `number`, required)
    - `price` (number, required, >= 0)
    - `currency` (string, default "VND")
    - `originalPrice` (number, >= 0)
    - `discountPercent` (number, 0-100)
    - `rating` (number, 0-5)
    - `soldCount` (integer, >= 0)
    - `stock` (integer, >= 0)
    - `location` (object with `region` and `district` strings per AD-18 reserved field standard; store raw source string under `locationRaw` when only unparsed text is available)
    - `sellerName` (string)
    - `categoryName` (string)
    - `brand` (string)

### AC3 — REST API Endpoints (`api/routes/schemas.js` & `api/server.js`)

- **Given** the Express API server running
- **When** sending HTTP requests:
  - `GET /api/schemas`: returns `{ success: true, data: { schemas: [...] } }` listing all registered schemas.
  - `GET /api/schemas/:platform/:category`: returns `{ success: true, data: { platform, category, schema } }`.
  - If schema does not exist for `:platform/:category`, returns `404` with `PlatformError({ type: ErrorTypes.INTERNAL, code: 'XACT_4041', statusCode: 404, message: 'Schema not found', suggestedAction: SuggestedActions.USE_ACTIONS_LIST })`.
- **And** route is mounted at `app.use('/api/schemas', schemasRoutes)` in `api/server.js` (the `/api` prefix is consistent with all other XActions REST routes; AD-18's `GET /schemas` is mapped to `/api/schemas` in this implementation).
- **And** public discovery endpoints do not require authentication, but support rate-limiting.

### AC4 — MCP Tools (`src/mcp/server.js`)

- **Given** an AI Agent connected via MCP
- **When** calling MCP tools:
  - `x_schema_list`: returns array of registered schema descriptors.
  - `x_schema_get`: requires arguments `{ platform: { type: 'string', required: true }, category: { type: 'string', required: true } }`. Returns the full JSON schema contract.

### AC5 — CLI Integration (`src/cli/index.js`)

- **Given** the CLI command `xactions schema ...`
- **When** running:
  - `xactions schema list [--json]`: lists all available schemas with platform and category.
  - `xactions schema get <platform> <category> [--json]`: outputs the JSON Schema definition.
- **And** returns `process.exitCode = 1` and error message if schema is not found.

### AC6 — PrismaStore Ingestion Validation Hook (`src/store/prisma-store.js`)

- **Given** `PrismaStore.storeContent(item)` or `storeBatch(items)`
- **When** storing a post that has a `metadata` object:
  - If a schema exists in `MetadataSchemaRegistry` for `(item.platform, item.category)`:
    - Validate `item.metadata`.
    - If valid, proceed with insertion.
    - If invalid, throw `PlatformError` (`XACT_4001`, `INVALID_ARGS`, `statusCode: 400`) containing validation error details.
  - For `storeBatch(items)`, validation for **ALL items** must happen **BEFORE** the Prisma transaction begins. If any item is invalid, abort the entire batch and throw `XACT_4001` immediately, indicating which item index failed.
  - If no schema is registered for `(item.platform, item.category)`, allow insertion without error (unbounded fallback).
  - Can be bypassed if option `{ validateSchema: false }` is explicitly passed.

### AC7 — TypeScript Definitions & Contracts (`types/metadata-schema.d.ts` & `types/index.d.ts`)

- **Given** TypeScript projects consuming XActions
- **When** importing types:
  - `export * as schemaRegistry from './metadata-schema'` in `types/index.d.ts`.
  - Type definitions for `JsonSchema`, `SchemaDescriptor`, `ValidationResult`, `MetadataSchemaRegistry`.
  - Strict TypeScript with zero `any`.

---

## Tasks / Subtasks

- [ ] **Task 1: Pilot JSON Schema Files (AC: AC2)**
  - [ ] Create directory `schemas/twitter/` and file `schemas/twitter/social.json`.
  - [ ] Create directory `schemas/shopee/` and file `schemas/shopee/ecom.json`.
  - [ ] Ensure valid JSON Schema Draft-07 format with proper titles, types, properties, and constraints.

- [ ] **Task 2: Metadata Schema Registry Service (AC: AC1)**
  - [ ] Create `src/core/metadata-schema-registry.js`.
  - [ ] Implement lightweight, zero-dependency JSON Schema validator supporting `type`, `required`, `properties`, `items`, `enum`, `minimum`, `maximum`, `pattern`.
  - [ ] Implement `MetadataSchemaRegistry` class with singleton default export `metadataSchemaRegistry`.
  - [ ] Auto-load `schemas/` directory on module load.
  - [ ] Re-export in `src/core/index.js`.

- [ ] **Task 3: PrismaStore Validation Integration (AC: AC6)**
  - [ ] Update `src/store/prisma-store.js` to validate `post.metadata` against `metadataSchemaRegistry` during `storeContent` and `storeBatch`.
  - [ ] Throw `PlatformError` (`XACT_4001`) with clear error message when validation fails.
  - [ ] Support `{ validateSchema: false }` option in `PrismaStore` constructor and method options.
  - [ ] Update `src/core/base-store.js` `AbstractStore` method signatures and `types/store.d.ts` to include `validateSchema?: boolean` in options.
  - [ ] If no schema is registered for a `(platform, category)` pair, allow the write to proceed unchanged (opt-in validation).

- [ ] **Task 4: REST API Endpoints (AC: AC3)**
  - [ ] Create `api/routes/schemas.js` with `GET /` and `GET /:platform/:category`.
  - [ ] Mount `/api/schemas` in `api/server.js`.

- [ ] **Task 5: CLI & MCP Integration (AC: AC4, AC5)**
  - [ ] Add `schema` command group in `src/cli/index.js` (`list`, `get <platform> <category>`, `--json`).
  - [ ] Add `x_schema_list` and `x_schema_get` tools in `src/mcp/server.js`.

- [ ] **Task 6: TypeScript Definitions & Test Suites (AC: AC7, all)**
  - [ ] Create `types/metadata-schema.d.ts` and update `types/index.d.ts`.
  - [ ] Create `tests/core/metadata-schema-registry.test.js` (unit tests for registry, validator, disk loading).
  - [ ] Create `tests/api/schemas-routes.test.js` (integration tests for `/api/schemas` endpoints).
  - [ ] Create `tests/store/prisma-store-schema-validation.test.js` (integration tests for PrismaStore validation). Must test:
    - `{ validateSchema: false }` bypass option.
    - `storeBatch` containing 1 invalid item among valid ones (must fail the whole batch with correct error).
  - [ ] Run full test suite and verify 100% green.

---

## Dev Notes

### Disaster Prevention & Technical Guardrails

- **Pre-Transaction Validation:** Never validate schemas inside a database transaction. In `storeBatch`, loop and validate the entire array first, then write to Prisma.
- **Synchronous Module Load:** It is completely acceptable and required to use `fs.readdirSync` during the initial module load of the registry to prevent async initialization issues for consumers.
- **Safe ESM Path Resolution:** Always use robust path resolution in ESM. Use `const __dirname = path.dirname(fileURLToPath(import.meta.url)); const schemasDir = path.resolve(__dirname, '../../schemas');` to avoid pathing disasters when running from different directories.
- **Zero-Dependency Constraint in `src/core/`:** As defined in `ARCHITECTURE-SPINE.md` and NFR15, `src/core/` must not import heavy npm packages like `ajv`. A lightweight, self-contained recursive validator (~80 lines) covers all required JSON schema rules including nested `properties` and `items`.
- **Pilot Schemas:** Twitter `social` and Shopee `ecom` serve as the reference standard for social media and e-commerce crawlers across upcoming epics.
- **Category Validation Order:** `PrismaStore.storeBatch` already validates `category` before writing. Add `metadata` validation **after** `category` validation and **before** normalizing/writing. This keeps error ordering predictable.
- **Error Shape:** All validation failures must be surfaced as `PlatformError({ type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001', statusCode: 400, message, suggestedAction: SuggestedActions.USE_ACTIONS_LIST, details: { index, errors } })`. Routes should use `error.toEnvelope()` for the response body.

### General Implementation Details

- **Registry Key:** Use `${platform}:${category}` as the in-memory cache key. It mirrors `Post.id` namespacing and is easy to search.
- **Schema Descriptor:** Extract `title`, `description`, and `version` from the root schema object. `version` may be omitted if not present. `propertiesCount` is the count of top-level `properties` keys.
- **Validator Capabilities:** Support `type` matching for primitives found in the payload. A JSON number matches `integer` only when `Number.isInteger`. Support `oneOf`/`anyOf` type lists (e.g. `itemId` may be `string` or `number`). Do not coerce strings to numbers or booleans.
- **Array `items`:** For `type: 'array'`, validate each element against `items` schema if `items` is present. For `hashtags` and `mentions`, `items: { type: 'string' }`.
- **Optional `metadata`:** A `null` or missing `metadata` should not trigger validation if a schema is registered (it is simply skipped). A `metadata` object present but invalid must trigger the error.

---

## Current Implementation State

- `prisma/schema.prisma` defines `Post.metadata Json?` and `Comment.metadata Json?` with a GIN index created via raw migration.
- `src/store/prisma-store.js` exists and implements `AbstractStore`. It already validates `category` before writes and uses 500-record chunked `createMany`/`skipDuplicates` or `upsert` transactions.
- `src/core/index.js` exports core modules. It must be extended with `MetadataSchemaRegistry` (or `metadataSchemaRegistry`) after creation.
- `src/core/error-envelope.js` provides `PlatformError`, `ErrorTypes`, `SuggestedActions`, and the standard envelope shape.
- `src/core/types.js` provides `CATEGORIES`, `CATEGORY_VALUES`, `generatePostId`, `generateCommentId`, and `isValidCategory`.
- `api/server.js` mounts routes with `app.use('/api/<path>', routes)`. Checkpoints are already mounted at `/api/checkpoints`.
- `src/cli/index.js` uses `commander` and has a pattern for nested subcommands (see `checkpoints` group).
- `src/mcp/server.js` uses a `TOOLS` array and a `executeTool(name, args)` switch. New tools are added by pushing to `TOOLS` and adding a `case`.
- No `schemas/` directory, `src/core/metadata-schema-registry.js`, `api/routes/schemas.js`, or `types/metadata-schema.d.ts` exists yet.
- `src/core/base-store.js` defines `AbstractStore` method signatures and may need `validateSchema` added to method options.
- `package.json` `files` array does not include `schemas/`; ensure schemas are reachable in installed/published builds.

---

## Developer Context

### Architecture Decisions Relevant to This Story

- **AD-4 — Namespaced PostgreSQL Storage via Prisma & JSONB GIN Indexing** (`ARCHITECTURE-SPINE.md`)
  - `Post.id` uses `${platform}:${externalId}`; `Comment.id` uses `${platform}:${postExternalId}:${commentExternalId}`.
  - `metadata` is a `Json?` column, indexed with GIN for fast key lookups.
  - AD-4 Rule 6 defines the Metadata Schema Contract: publish JSON Schema per `platform/category`, validate on write, expose through API/CLI/MCP.
- **AD-18 — Metadata Schema Contract for Consumers** (`ARCHITECTURE-SPINE.md`)
  - Schema files live at `schemas/<platform>/<category>.json` or TypeScript types.
  - Discovery endpoints: `GET /schemas` and `GET /schemas/:platform/:category`.
  - MCP tool `x_schema_get` and CLI `xactions schema get <platform> <category>`.
  - Reserved fields (`price`, `salary`, `phone`, `rating`, `soldCount`, `skills`, `location`) must use standardized types.
- **AD-7 — Dual-Channel Microservice Protocol for Nowing** (`ARCHITECTURE-SPINE.md`)
  - MCP daemon port 3001 (`/mcp`) and REST API (`/api/*`) are the two primary consumer surfaces. Schemas must be discoverable on both.
- **AD-11 — CrawlerCommand & ActionRegistry** (`ARCHITECTURE-SPINE.md`)
  - `AbstractCrawler` actions are `snake_case`. Schema file names and category values should be stable public contracts; prefer `social`/`ecom`/`realestate`/`recruitment`/`b2b`.
- **NFR15 — Clean Architecture & Extensibility** (`epics.md`)
  - `src/core/` must remain 100% platform-agnostic and free of heavy external dependencies.

### Files to Read Before Modifying

1. `src/core/types.js` — `PostItem` / `CommentItem` typedefs, `CATEGORIES`, ID helpers.
2. `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`, `toEnvelope`.
3. `src/store/prisma-store.js` — `storeBatch`, `storeContent`, `#normalizePost`, category validation, `AbstractStore` extension.
4. `src/core/base-store.js` / `src/core/index.js` — how core contracts are exported and the `AbstractStore` interface.
5. `api/routes/checkpoints.js` — route pattern, auth middleware, response envelope, pagination helper.
6. `src/cli/index.js` — `commander` command group pattern (see `checkpoints` group).
7. `src/mcp/server.js` — `TOOLS` definition and `executeTool` switch pattern.
8. `api/server.js` — route mounting.
9. `types/store.d.ts` / `types/index.d.ts` — TypeScript declaration patterns.

---

## Previous Story Intelligence

### From Story 10.4

- Dual-channel auth (`api/middleware/auth.js` and `src/a2a/auth.js`) is reused by checkpoints. Schema routes can be public or use a lightweight rate limit; auth is not required for read-only schema discovery per AC3.
- `PlatformError` uses `ErrorTypes.INVALID_ARGS` and `SuggestedActions.USE_ACTIONS_LIST` for client errors; `XACT_4041` for not found.
- `src/cli/index.js` uses `process.exitCode = 1` on errors and disconnects `prisma` in `finally`.
- `src/store/checkpoint-manager.js` centralizes business logic; for this story, `src/core/metadata-schema-registry.js` is the core service and `src/store/prisma-store.js` is the consumer.

### From Story 10.3

- Real-DB tests are mandatory; do not mock `PrismaClient`.
- CLI output uses `chalk` for human-readable mode and JSON with `--json`.
- Supertest is the existing integration test approach for HTTP routes.

### From Story 10.2

- `PrismaStore` writes `Post`/`Comment` via `createMany`/`skipDuplicates` in 500-record chunks, with optional `upsert`.
- `Comment` has `depth` and `parentCommentId` for topological insertion.
- `Post.metadata` and `Comment.metadata` are stored as plain JS objects; do not stringify.

---

## Git Intelligence

- Implementation artifacts live in `_bmad-output/implementation-artifacts/`.
- Runtime code belongs under `src/`, `api/`, and `src/cli/`.
- Tests live under `tests/` mirroring source structure.
- Commit message pattern: `feat(story 10.5): <short summary>` or `test(story 10.5): <short summary>`.
- Recent pattern: atomic commits per story, update `sprint-status.yaml` after implementation.

---

## Latest Tech Information

- Prisma 5.x `findMany` with `take`/`skip` is the idiomatic pagination for PostgreSQL.
- Prisma returns `Date` objects; Express `res.json()` serializes them to ISO-8601 strings automatically.
- Express `Router` should be mounted with `app.use('/api/schemas', schemasRoutes)`.
- `commander` supports nested subcommands with `.command('sub <arg>')` and `.option(...)`.
- `supertest` is the project's existing integration test approach for HTTP routes.
- Node.js ESM path resolution: use `import.meta.url` + `fileURLToPath` + `path.dirname` to compute `__dirname`.
- TypeScript `export * as` namespaces can be used in `types/index.d.ts` to group metadata-schema types.

---

## Project Context Reference

- **Project:** XActions
- **Project key:** XACT
- **Repository:** https://github.com/deptrai/XActions
- **Tech:** Node.js ESM, Prisma, PostgreSQL, Vitest, Express, Commander
- **package.json engines:** `node >=18.0.0`
- **Architecture:** Hexagonal + Tiered Hybrid Signer + Adaptive Rate Limiter

---

## Warnings & Potential Pitfalls

1. **Do not add heavy validators to `src/core/`.** `ajv` and similar packages violate NFR15. The validator must be hand-rolled and self-contained.
2. **Do not modify `prisma/schema.prisma` in this story.** The `Post.metadata` and `Comment.metadata` JSONB columns already exist.
3. **Do not fail writes when no schema is registered.** Unbounded fallback is required by AC6; schemas are opt-in contracts, not mandatory gates.
4. **Do not crash if `schemas/` is missing on module load.** The registry must start empty and log a warning; this is required for tests and clean installs.
5. **Do not validate inside a Prisma transaction.** Validate all batch items before starting the transaction.
6. **Do not create a new auth system.** Schema discovery is public; rate-limiting is optional.
7. **Do not return Prisma internals in error messages.** Use `PlatformError` with `code`, `message`, and `statusCode`.
8. **Do not mock Prisma in tests.** Use the real `xactions_test` database.
9. **Do not allow unbounded `limit` in API/CLI.** Cap at `500` and default to `50` for list endpoints if any are added later.
10. **Do not use relative `__dirname` without `import.meta.url` in ESM.** The registry must resolve `schemas/` correctly regardless of cwd.
11. **Do not forget `package.json` `files`.** If the package is published, add `schemas/` to the `files` array (or copy schemas into `src/`) so the registry can find them in installed builds.
12. **Do not validate `Comment.metadata` in this story.** Scope is `Post.metadata` per AC6. Comment metadata contracts can be added later when AD-18 is extended.
13. **Scope boundary:** This story is the **schema contract and registry**, not the crawler itself. Do not implement platform-specific scrapers or data transformation beyond the two pilot schemas.

---

## Decisions Record

- `metadata` JSON schema validation is **opt-in per platform/category**. If no schema is registered for a `(platform, category)` pair, `PrismaStore` writes the metadata as-is.
- The schema registry is a `src/core` service with a singleton default export (`metadataSchemaRegistry`) so `PrismaStore`, API, CLI, and MCP can share the same in-memory cache.
- Schema files live in a new top-level `schemas/` directory. The registry loads them synchronously at module initialization and caches them in memory.
- Validation failures throw `PlatformError` (`XACT_4001`, `INVALID_ARGS`, `statusCode: 400`) with a `details` object containing the item index and validation errors.
- REST discovery routes are mounted under `/api/schemas` to match the existing XActions route convention (`/api/*`), even though AD-18 uses the shorthand `/schemas`. The public path remains `/api/schemas`.
- CLI and MCP only expose read/list operations. Schema registration is file-driven or programmatic, not operator-editable in this story.
- Public read access for schema discovery is acceptable because the schemas are public contracts for consumers; rate limiting can be added later.
- Reserved field types (`price`, `salary`, `phone`, etc.) should be documented in the pilot schemas and future schemas must follow the same conventions.

---

## Story Completion Status

- **Status:** `done`
- **Context engine analysis completed:** comprehensive developer guide created.
- **Dev implementation:** completed.
- **Code Review:** completed; Round 3 patches applied.

---

## Dev Agent Record

### Agent Model Used

- DeepMind Antigravity Coding Agent (Pair Programmer) / `bmad-create-story`

### Completion Notes List

- Extracted comprehensive context from `epics.md` (Story 10.5), `ARCHITECTURE-SPINE.md` (AD-4 Rule 6, AD-18), `ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md`, `prisma/schema.prisma`, and existing implementations (`src/store/prisma-store.js`, `src/cli/index.js`, `src/mcp/server.js`, `api/server.js`, `src/core/index.js`).
- Synchronized story file with current code patterns: `PlatformError` shape, `PrismaStore` pre-transaction validation, ESM path resolution, and `commander`/`MCP` patterns from Story 10.4.

### File List

- `_bmad-output/implementation-artifacts/10-5-metadata-schema-contract-registry-for-consumers.md` (New: this story file)

### Change Log

- **2026-08-19:** Created Story 10.5 context file and updated sprint status to `ready-for-dev`.
- **2026-08-19:** Validated story against `checklist.md`: fixed `PlatformError` type for 404, clarified multi-type and reserved `location` fields, added `schemas/` packaging and missing-directory guards, and documented `/api/schemas` route prefix decision.
- **2026-08-19:** Code review (Round 3): applied all 7 patches — skip null/undefined metadata, fix `ErrorTypes.NOT_FOUND` → `ErrorTypes.INTERNAL`, use `version` not `$schema`, standardize API error envelope, MCP `isError` for missing schemas, real-DB test for `validateSchema: false`, and tighten `types/metadata-schema.d.ts`. Also updated pre-existing test fixtures to conform to the new Shopee e-commerce schema.

### Review Findings (Round 3 — Code Review Run)

- [x] [Review][Patch] Null/undefined `metadata` is not skipped when a schema is registered; `validateMetadata` and `PrismaStore` reject posts without metadata for any schema-registered `(platform, category)` pair. This violates the story's opt-in validation contract and will break crawlers that do not yet populate metadata. [src/core/metadata-schema-registry.js:219-230, src/store/prisma-store.js:198-212]
- [x] [Review][Patch] `api/routes/schemas.js` and `src/cli/index.js` reference `ErrorTypes.NOT_FOUND`, which does not exist in `ErrorTypes`; the error type silently falls back to `internal`. Both should use `ErrorTypes.INTERNAL` with `statusCode: 404` per the story spec. [api/routes/schemas.js:37, src/cli/index.js:3416]
- [x] [Review][Patch] `MetadataSchemaRegistry.listSchemas` populates `version` from `schema.$schema` (the JSON Schema draft URI) instead of a real `version` property, making the `version` descriptor misleading. [src/core/metadata-schema-registry.js:208]
- [x] [Review][Patch] `GET /api/schemas` error response returns `error.message` instead of the standard `error.toEnvelope()` envelope used by the rest of the XActions API. [api/routes/schemas.js:20]
- [x] [Review][Patch] `x_schema_get` in `src/mcp/server.js` returns a plain `{ error: string }` object for missing schemas; the MCP server treats it as a successful result. It should throw a `PlatformError` or return an MCP `isError` result. [src/mcp/server.js:4804-4811]
- [x] [Review][Patch] `tests/store/prisma-store-schema-validation.test.js` uses a mocked/fake `prisma` object in the `validateSchema: false` test, violating the project's "no mocks" rule and the story's real-PostgreSQL test requirement. [tests/store/prisma-store-schema-validation.test.js:45-60]
- [x] [Review][Patch] `types/metadata-schema.d.ts` has `ValidationResult.errors?: string[]` (optional) while the runtime always returns an `errors` array, and `validateMetadata` accepts `metadata: object` which is too narrow for null/undefined/unknown inputs. [types/metadata-schema.d.ts:24-27, types/metadata-schema.d.ts:62]

### Dismissed Edge-Case Findings

- `additionalProperties` validation is not implemented — out of scope; no schema uses it.
- Case-sensitivity of platform/category and `:` in platform names — not required by the contract; platform/category are stable lowercase tokens.
- URL-decoding of path params — Express `req.params` already decodes path segments.
- Stack overflow on deeply nested metadata — theoretical; metadata is expected to be shallow.
- Schema file JSON parse errors are logged and skipped — acceptable startup behavior; malformed schemas do not crash the process.
