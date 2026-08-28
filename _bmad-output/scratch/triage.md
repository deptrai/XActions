# Triage Results

1. **id**: 1
   **source**: auditor
   **title**: Missing `oneOf`/`anyOf` Validation Support
   **detail**: `validateSchemaNode` in `src/core/metadata-schema-registry.js` lacks logic to validate `oneOf` and `anyOf` schema properties, failing the AC1 Validator Capabilities constraint.
   **location**: `src/core/metadata-schema-registry.js`
   **severity**: high
   **route**: patch

2. **id**: 2
   **source**: auditor
   **title**: Incorrect `location` Structure in Shopee Schema
   **detail**: `schemas/shopee/ecom.json` defines `location` as a string type instead of an object with `region` and `district`, and misses the `locationRaw` property (violates AD-18).
   **location**: `schemas/shopee/ecom.json`
   **severity**: medium
   **route**: patch

3. **id**: 3
   **source**: auditor
   **title**: Deviating Type Constraints for `itemId` and `shopId`
   **detail**: The Shopee pilot schema uses an array `["string", "number"]` for types instead of the required `oneOf` structure requested in the spec.
   **location**: `schemas/shopee/ecom.json`
   **severity**: medium
   **route**: patch

4. **id**: 4
   **source**: auditor
   **title**: Missing Payload Fields in `GET /api/schemas/:platform/:category`
   **detail**: `api/routes/schemas.js` responds with `{ success: true, data: { schema } }`, omitting the required `platform` and `category` parameters from the `data` envelope.
   **location**: `api/routes/schemas.js`
   **severity**: medium
   **route**: patch

5. **id**: 5
   **source**: auditor
   **title**: Incomplete Error Envelope for 404 Route Response
   **detail**: The 404 `PlatformError` omits `suggestedAction: SuggestedActions.USE_ACTIONS_LIST` and uses `ErrorTypes.NOT_FOUND` instead of the specified `ErrorTypes.INTERNAL`.
   **location**: `api/routes/schemas.js`
   **severity**: low
   **route**: patch

6. **id**: 6
   **source**: auditor
   **title**: Missing `schemas` Directory Export in `package.json`
   **detail**: The `"schemas"` directory was not added to the `"files"` array in `package.json`, which will exclude schema files from npm published builds.
   **location**: `package.json`
   **severity**: high
   **route**: patch

7. **id**: 7
   **source**: auditor
   **title**: Invalid ESM Path Resolution in Registry Tests
   **detail**: `tests/core/metadata-schema-registry.test.js` incorrectly uses `__dirname` without declaring it via `import.meta.url`, which fails in standard Node ESM environments.
   **location**: `tests/core/metadata-schema-registry.test.js:7`
   **severity**: high
   **route**: patch

8. **id**: 8
   **source**: auditor
   **title**: Broken Import Causing Store Test Failure
   **detail**: `PlatformError` is incorrectly imported from `src/core/types.js` instead of `src/core/error-envelope.js` in `tests/store/prisma-store-schema-validation.test.js`.
   **location**: `tests/store/prisma-store-schema-validation.test.js:4`
   **severity**: high
   **route**: patch

9. **id**: 9
   **source**: auditor
   **title**: Missing and Incomplete Interface Types
   **detail**: `types/metadata-schema.d.ts` omits `JsonSchema` and `SchemaDescriptor` definitions, and `listSchemas()` return type is incomplete.
   **location**: `types/metadata-schema.d.ts`
   **severity**: medium
   **route**: patch

10. **id**: 10
    **source**: blind
    **title**: `schema get` Command Brutal Kill
    **detail**: The `schema get` command uses `process.exit(1)` when a schema is not found, bypassing the adjacent `printCliError` handler and graceful shutdown logic.
    **location**: `src/cli/index.js`
    **severity**: low
    **route**: patch

11. **id**: 11
    **source**: blind
    **title**: Synchronous Validation in 500-item Loop
    **detail**: `metadataSchemaRegistry.validateMetadata` is called synchronously in a loop of up to 500 items, which could marginally stall the event loop.
    **location**: `src/store/prisma-store.js`
    **severity**: low
    **route**: defer
