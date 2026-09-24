// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Build committed OpenAPI specification artifact (Story 46.3).
 *
 * Runs generateSpec() from api/openapi.js, validates it (3.1.0, non-empty
 * paths, 5 securitySchemes), and writes pretty-printed JSON to
 * api/openapi.json with a trailing newline.
 *
 * @author nich (@nichxbt)
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSpec } from '../api/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const outputPath = resolve(rootDir, 'api', 'openapi.json');

try {
  const spec = generateSpec();

  if (!spec || typeof spec !== 'object') {
    throw new Error('generateSpec() returned null/non-object');
  }
  if (spec.openapi !== '3.1.0') {
    throw new Error(`generateSpec() produced openapi ${spec.openapi}, expected 3.1.0`);
  }

  const paths = Object.keys(spec.paths || {});
  if (paths.length < 50) {
    throw new Error(`generateSpec() produced suspiciously few paths (${paths.length}), expected >50`);
  }

  const schemes = Object.keys(spec.components?.securitySchemes || {});
  if (schemes.length < 5) {
    throw new Error(`generateSpec() produced only ${schemes.length} securitySchemes, expected 5`);
  }

  const content = JSON.stringify(spec, null, 2) + '\n';
  writeFileSync(outputPath, content, 'utf8');

  console.log(`📋 Wrote api/openapi.json (${paths.length} paths, ${schemes.length} schemes)`);
  process.exit(0);
} catch (err) {
  console.error('❌ Failed to build api/openapi.json:', err.message);
  process.exit(1);
}
