// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.3 — api-client generator contract tests.
 *
 * Verifies `npm run generate:api-client` against a fixture spec:
 *   - emits parseable schema.d.ts
 *   - emits client.ts with typed method stubs keyed by operationId
 *   - emitted files are byte-identical on re-run (idempotent)
 *   - failure modes: missing openapi.json, malformed JSON, wrong version
 *   - runtime client execution: auth injection, 402 handling, custom fetch
 *   - uses --out to avoid clobbering production packages/api-client
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..', '..');
const fixturePath = resolve(rootDir, 'tests', 'fixtures', 'openapi-fixture.json');
const genScript = resolve(rootDir, 'scripts', 'generate-api-client.mjs');
const prodOutDir = resolve(rootDir, 'packages', 'api-client');

let testOutDir;
let tmpDir;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'api-client-contract-'));
  testOutDir = resolve(tmpDir, 'client-pkg');
});

afterAll(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  // Ensure production packages/api-client is cleanly regenerated from committed spec
  execFileSync('node', [genScript, '--force'], { cwd: rootDir, stdio: 'ignore' });
});

describe('Story 46.3 — api-client generator', () => {
  it('fails loudly when spec is missing', () => {
    const missingPath = resolve(tmpDir, 'non-existent-spec.json');
    expect(() =>
      execFileSync('node', [genScript, '--spec', missingPath, '--out', testOutDir], {
        cwd: rootDir,
        stdio: 'pipe',
      })
    ).toThrow();
  });

  it('fails loudly when spec is malformed JSON', () => {
    const badPath = resolve(tmpDir, 'bad-json.json');
    writeFileSync(badPath, '{ not valid json', 'utf8');
    expect(() =>
      execFileSync('node', [genScript, '--spec', badPath, '--out', testOutDir], {
        cwd: rootDir,
        stdio: 'pipe',
      })
    ).toThrow();
  });

  it('fails loudly when spec is not 3.1.0', () => {
    const badVerPath = resolve(tmpDir, 'bad-version.json');
    writeFileSync(badVerPath, JSON.stringify({ openapi: '3.0.0', paths: { '/x': {} } }), 'utf8');
    expect(() =>
      execFileSync('node', [genScript, '--spec', badVerPath, '--out', testOutDir], {
        cwd: rootDir,
        stdio: 'pipe',
      })
    ).toThrow();
  });

  it('fails loudly when spec has empty paths', () => {
    const emptyPath = resolve(tmpDir, 'empty-paths.json');
    writeFileSync(
      emptyPath,
      JSON.stringify({ openapi: '3.1.0', info: { title: 'x', version: '0' }, paths: {} }),
      'utf8'
    );
    expect(() =>
      execFileSync('node', [genScript, '--spec', emptyPath, '--out', testOutDir], {
        cwd: rootDir,
        stdio: 'pipe',
      })
    ).toThrow();
  });

  it('generates schema.d.ts and client.ts against fixture spec (isolated --out)', () => {
    execFileSync('node', [genScript, '--spec', fixturePath, '--out', testOutDir, '--force'], {
      cwd: rootDir,
      stdio: 'pipe',
    });

    expect(existsSync(resolve(testOutDir, 'schema.d.ts'))).toBe(true);
    expect(existsSync(resolve(testOutDir, 'client.ts'))).toBe(true);
    expect(existsSync(resolve(testOutDir, 'index.ts'))).toBe(true);
    expect(existsSync(resolve(testOutDir, 'package.json'))).toBe(true);
    expect(existsSync(resolve(testOutDir, 'README.md'))).toBe(true);

    const clientSrc = readFileSync(resolve(testOutDir, 'client.ts'), 'utf8');
    expect(clientSrc).toContain('export class XActionsClient');
    expect(clientSrc).toContain('isPaymentRequired');
    expect(clientSrc).toContain('PaymentRequiredPayload');
    // Method stubs keyed by operationId → camelCase
    expect(clientSrc).toContain('async getApiTestGetThing');
    expect(clientSrc).toContain('async postApiTestDoThing');
    expect(clientSrc).toContain('async postApiTestAuthThing');
    // Auth headers present for declared schemes
    expect(clientSrc).toContain('x-session-cookie');
    expect(clientSrc).toContain('X-PAYMENT');
    expect(clientSrc).toContain('Authorization');

    const schemaSrc = readFileSync(resolve(testOutDir, 'schema.d.ts'), 'utf8');
    expect(schemaSrc).toMatch(/export (interface|type) paths/);
    expect(schemaSrc).toContain('/api/test/get-thing');
    expect(schemaSrc).toContain('/api/test/do-thing');
  });

  it('generator output is byte-identical on re-run (idempotent)', () => {
    execFileSync('node', [genScript, '--spec', fixturePath, '--out', testOutDir, '--force'], {
      cwd: rootDir,
      stdio: 'pipe',
    });
    const firstClient = readFileSync(resolve(testOutDir, 'client.ts'), 'utf8');
    const firstSchema = readFileSync(resolve(testOutDir, 'schema.d.ts'), 'utf8');
    const firstIndex = readFileSync(resolve(testOutDir, 'index.ts'), 'utf8');

    execFileSync('node', [genScript, '--spec', fixturePath, '--out', testOutDir, '--force'], {
      cwd: rootDir,
      stdio: 'pipe',
    });
    expect(readFileSync(resolve(testOutDir, 'client.ts'), 'utf8')).toBe(firstClient);
    expect(readFileSync(resolve(testOutDir, 'schema.d.ts'), 'utf8')).toBe(firstSchema);
    expect(readFileSync(resolve(testOutDir, 'index.ts'), 'utf8')).toBe(firstIndex);
  });

  it('emitted package.json exports map uses types conditions (Node ESM safe)', () => {
    const pkg = JSON.parse(readFileSync(resolve(prodOutDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@xactions/api-client');
    expect(pkg.type).toBe('module');
    expect(pkg.exports?.['.']?.types).toBe('./index.ts');
    expect(pkg.exports?.['./schema']?.types).toBe('./schema.d.ts');
  });

  it('client.ts ApiResult union covers 402 PaymentRequired and type guard', () => {
    const clientSrc = readFileSync(resolve(prodOutDir, 'client.ts'), 'utf8');
    expect(clientSrc).toContain('status === 402');
    expect(clientSrc).toContain('isPaymentRequired');
    expect(clientSrc).toContain('x402Version');
    expect(clientSrc).toContain('accepts');
  });

  it('XActionsClient runtime: sends auth headers and JSON body via custom fetch', async () => {
    const { XActionsClient, isPaymentRequired } = await import(resolve(prodOutDir, 'client.ts'));
    let capturedUrl = '';
    let capturedInit = {};

    const mockFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ success: true, data: { status: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = new XActionsClient({
      baseUrl: 'http://test.local',
      sessionCookie: 'sess-123',
      bearerToken: 'jwt-456',
      x402Payment: 'xpay-789',
      fetch: mockFetch,
    });

    // Test a pilot method stub generated in client.ts
    const res = await client.postApiViralMine({ body: { platform: 'x', niche: 'tech' } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ status: 'ok' });

    expect(capturedUrl).toBe('http://test.local/api/viral/mine');
    expect(capturedInit.method).toBe('POST');
    expect(capturedInit.headers['x-session-cookie']).toBe('sess-123');
    expect(capturedInit.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(capturedInit.body)).toEqual({ platform: 'tech', niche: 'tech', platform: 'x' });
  });

  it('XActionsClient runtime: parses 402 PaymentRequired as x402 payload', async () => {
    const { XActionsClient, isPaymentRequired } = await import(resolve(prodOutDir, 'client.ts'));
    const paymentPayload = {
      x402Version: 2,
      accepts: [{ scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '$0.001', payTo: '0xabc' }],
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(paymentPayload), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      });

    const client = new XActionsClient({ baseUrl: 'http://test.local', fetch: mockFetch });
    const res = await client.request('http://test.local/api/ai/scrape/profile');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(402);
    expect(isPaymentRequired(res)).toBe(true);
    if (isPaymentRequired(res)) {
      expect(res.error.x402Version).toBe(2);
      expect(res.error.accepts[0].network).toBe('eip155:8453');
    }
  });

  it('XActionsClient runtime: parses canonical 401 error envelope', async () => {
    const { XActionsClient } = await import(resolve(prodOutDir, 'client.ts'));
    const errorEnvelope = {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing session cookie' },
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(errorEnvelope), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });

    const client = new XActionsClient({ baseUrl: 'http://test.local', fetch: mockFetch });
    const res = await client.request('http://test.local/api/viral/mine');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error.code).toBe('UNAUTHORIZED');
    expect(res.error.message).toBe('Missing session cookie');
  });

  it('packages/api-client compiles cleanly via tsc --noEmit', () => {
    expect(() =>
      execFileSync('npx', ['tsc', '--project', resolve(prodOutDir, 'tsconfig.json')], {
        cwd: rootDir,
        stdio: 'pipe',
      })
    ).not.toThrow();
  });
});
