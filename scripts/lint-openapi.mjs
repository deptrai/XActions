// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * lint:openapi — Story 46.2 contract gate.
 *
 * Generates the unified OpenAPI document from `api/openapi.js` (literal /api/ai
 * section + registry-generated pilot paths), writes it to a temp file, then
 * runs `@redocly/cli lint` against it. Exits non-zero on lint errors.
 *
 * Usage: npm run lint:openapi
 */
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const { generateSpec } = await import('../api/openapi.js');
const spec = generateSpec();

const dir = await mkdtemp(path.join(tmpdir(), 'xactions-openapi-'));
const specPath = path.join(dir, 'openapi.json');
await writeFile(specPath, JSON.stringify(spec, null, 2));

console.log(`📋 Generated spec: openapi ${spec.openapi}, ${Object.keys(spec.paths ?? {}).length} paths`);

try {
  const { stdout, stderr } = await execFileAsync(
    'npx',
    ['--yes', '@redocly/cli', 'lint', specPath, '--format', 'stylish'],
    { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, FORCE_COLOR: '0' } }
  );
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  console.log('✅ OpenAPI lint passed');
} catch (err) {
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.error(err.stderr);
  console.error('❌ OpenAPI lint failed');
  process.exitCode = err.code ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
