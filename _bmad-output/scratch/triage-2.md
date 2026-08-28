# Triage Results (Round 2)

1. **id**: 1
   **source**: blind+edge
   **title**: Bypass Validation via Undefined Metadata
   **detail**: `PrismaStore.storeBatch` checks `if (shouldValidateSchema && post.metadata)`. If `post.metadata` is falsy, validation is bypassed even if the schema requires it.
   **location**: `src/store/prisma-store.js:198`
   **severity**: high
   **route**: patch

2. **id**: 2
   **source**: blind+edge
   **title**: Complete Ignorance of `null` Types
   **detail**: The type validation in `validateSchemaNode` explicitly checks for string, number, integer, boolean, object, and array, but completely ignores the valid JSON Schema type `"null"`.
   **location**: `src/core/metadata-schema-registry.js`
   **severity**: medium
   **route**: patch

3. **id**: 3
   **source**: auditor
   **title**: Missing `statusCode: 400` in Validation Errors
   **detail**: The `PlatformError` thrown during schema validation failure in `PrismaStore` omits the `statusCode: 400` property mandated by the spec.
   **location**: `src/store/prisma-store.js`
   **severity**: medium
   **route**: patch

4. **id**: 4
   **source**: auditor
   **title**: Incorrect Error Type for 404 in API Routes
   **detail**: The schema 404 route throws `ErrorTypes.INTERNAL` instead of `ErrorTypes.NOT_FOUND` as stated in the developer checklist.
   **location**: `api/routes/schemas.js`
   **severity**: low
   **route**: patch

5. **id**: 5
   **source**: auditor
   **title**: Incomplete `MetadataSchemaRegistry` Interface in Typings
   **detail**: The TS interface is missing `hasSchema()` and `loadSchemasFromDisk()`, and `ValidationResult.errors` is typed as `unknown[]` instead of `string[]`.
   **location**: `types/metadata-schema.d.ts`
   **severity**: medium
   **route**: patch

6. **id**: 6
   **source**: auditor
   **title**: Inclusion of Unrelated Test File
   **detail**: The diff includes an out-of-scope test file `tests/core/core-automation.test.js` which should be removed or excluded from this story's changes.
   **location**: `tests/core/core-automation.test.js`
   **severity**: low
   **route**: patch

7. **id**: 7
   **source**: edge
   **title**: `schemasDir` is a file instead of a directory
   **detail**: `loadSchemasFromDisk` checks `fs.existsSync(schemasDir)` but does not verify it is a directory before calling `fs.readdirSync`.
   **location**: `src/core/metadata-schema-registry.js`
   **severity**: low
   **route**: patch

8. **id**: 8
   **source**: edge
   **title**: Invalid `schema.pattern` SyntaxError
   **detail**: `new RegExp(schema.pattern)` can throw a `SyntaxError` if the pattern is malformed, crashing the validator.
   **location**: `src/core/metadata-schema-registry.js`
   **severity**: medium
   **route**: patch

9. **id**: 9
   **source**: edge
   **title**: `data is null` throws TypeError on object validation
   **detail**: When checking required fields on an object, `if (data[req] === undefined)` throws a TypeError if `data` is `null`.
   **location**: `src/core/metadata-schema-registry.js`
   **severity**: medium
   **route**: patch
