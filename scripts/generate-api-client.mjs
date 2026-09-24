// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Generate @xactions/api-client from committed api/openapi.json (Story 46.3).
 *
 * Reads the committed spec (never a live server — deterministic, reviewable
 * in diffs, reproducible in CI), emits `schema.d.ts` via openapi-typescript,
 * scaffolds `client.ts`/`index.ts`/`README.md`/`package.json`/`tsconfig.json`,
 * and emits typed method stubs keyed by operationId.
 *
 * Auth schemes map to constructor opts:
 *   bearerAuth → bearerToken     (Authorization: Bearer <jwt>)
 *   sessionCookie → sessionCookie (x-session-cookie header)
 *   x402Payment → x402Payment    (X-PAYMENT header)
 *   a2aApiKey → a2aApiKey        (X-Agent-API-Key header)
 *   apiKey → apiKey              (X-API-Key header)
 *
 * ApiResult<T> union:
 *   {ok:true, status:number, data:T}
 *   | {ok:false, status:402, error:PaymentRequiredPayload}
 *   | {ok:false, status:number, error:ApiErrorPayload}
 *
 * Usage:
 *   npm run generate:api-client
 *   node scripts/generate-api-client.mjs --spec <file> --out <dir> --force
 *
 * @author nich (@nichxbt)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Parse CLI flags: --spec <path>, --out <dir>, --force
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}
const customSpec = getArg('--spec');
const customOut = getArg('--out');
const force = args.includes('--force');

const specPath = customSpec ? resolve(rootDir, customSpec) : resolve(rootDir, 'api', 'openapi.json');
const outDir = customOut ? resolve(rootDir, customOut) : resolve(rootDir, 'packages', 'api-client');

// ── Load + validate spec ────────────────────────────────────────────────────
if (!existsSync(specPath)) {
  console.error(`❌ api/openapi.json not found at ${specPath}`);
  console.error(`   Run \`npm run build:openapi\` first to emit the committed artifact.`);
  process.exit(1);
}

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} catch (err) {
  console.error(`❌ api/openapi.json is malformed JSON: ${err.message}`);
  process.exit(1);
}

if (!spec || typeof spec !== 'object' || spec.openapi !== '3.1.0') {
  console.error(`❌ api/openapi.json is openapi ${spec?.openapi}, expected 3.1.0`);
  process.exit(1);
}

const pathCount = Object.keys(spec.paths || {}).length;
if (pathCount === 0) {
  console.error(`❌ api/openapi.json has empty paths — nothing to generate`);
  process.exit(1);
}

console.log(`📋 Loaded spec: openapi ${spec.openapi}, ${pathCount} paths`);
mkdirSync(outDir, { recursive: true });

// ── Emit schema.d.ts via openapi-typescript ────────────────────────────────
const schemaPath = resolve(outDir, 'schema.d.ts');
try {
  execFileSync(
    'npx',
    ['--yes', 'openapi-typescript', specPath, '-o', schemaPath],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  console.log(`✅ Wrote ${schemaPath}`);
} catch (err) {
  console.error(`❌ openapi-typescript failed: ${err.stderr?.toString() || err.message}`);
  process.exit(1);
}

// ── Method name derivation ──────────────────────────────────────────────────
function toMethodName(opId) {
  if (!opId) return null;
  // Clean all non-alphanumeric chars into underscores first
  const clean = opId.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!clean.includes('_')) {
    return clean.charAt(0).toLowerCase() + clean.slice(1);
  }
  return clean
    .split('_')
    .filter(Boolean)
    .map((seg, i) => (i === 0 ? seg.toLowerCase() : seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()))
    .join('');
}

const SCHEME_HEADERS = {
  bearerAuth: { opt: 'bearerToken', header: 'Authorization' },
  sessionCookie: { opt: 'sessionCookie', header: 'x-session-cookie' },
  x402Payment: { opt: 'x402Payment', header: 'X-PAYMENT' },
  a2aApiKey: { opt: 'a2aApiKey', header: 'X-Agent-API-Key' },
  apiKey: { opt: 'apiKey', header: 'X-API-Key' },
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']);
const globalSecurity = Array.isArray(spec.security) ? spec.security : [];

const ops = [];
for (const [path, item] of Object.entries(spec.paths || {}).sort(([a], [b]) => a.localeCompare(b))) {
  for (const method of Object.keys(item || {}).sort()) {
    if (!HTTP_METHODS.has(method)) continue;
    const op = item[method];
    const opId = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`;
    const methodName = toMethodName(opId);
    // op.security overrides top-level; if undefined, inherit spec.security
    const securities = op.security !== undefined ? (Array.isArray(op.security) ? op.security : []) : globalSecurity;
    const schemeNames = [...new Set(securities.flatMap((s) => Object.keys(s || {})))];
    ops.push({ path, method, opId, methodName, schemeNames, summary: op.summary });
  }
}

console.log(`🔧 Generating ${ops.length} method stubs (deterministic order)`);

const methodStubs = ops
  .map(({ path, method, methodName, schemeNames, summary }) => {
    const headerLines = schemeNames
      .filter((s) => SCHEME_HEADERS[s])
      .map((s) => {
        const m = SCHEME_HEADERS[s];
        const val = s === 'bearerAuth' ? '`Bearer ${this.bearerToken}`' : `this.${m.opt}`;
        return `      if (this.${m.opt}) headers['${m.header}'] = ${val};`;
      })
      .join('\n');
    const hasBody = ['post', 'put', 'patch'].includes(method);
    const bodyType = hasBody ? ' & { body?: unknown }' : '';
    const bodyHandling = hasBody
      ? `\n    if (opts.body !== undefined) {\n      headers['Content-Type'] = 'application/json';\n      init.body = JSON.stringify(opts.body);\n    }`
      : '';
    const doc = summary ? `  /** ${summary.replace(/\*\//g, '*\\/')} (${method.toUpperCase()} ${path}) */\n` : '';
    return `${doc}  async ${methodName}<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> }${bodyType} = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
${headerLines || '      // no auth scheme declared'}
    const init: RequestInit = { method: '${method.toUpperCase()}', headers };
    let url = this.baseUrl + '${path}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }${bodyHandling}
    return this.request<T>(url, init);
  }`;
  })
  .join('\n\n');

const clientTs = `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions typed API client — Story 46.3 (Epic 46).
 *
 * Thin fetch wrapper around the OpenAPI 3.1 spec. Generated method stubs are
 * emitted per-operationId; the core \`request\` method is hand-written and
 * stable across regenerations.
 *
 * ApiResult<T> union:
 *   success → { ok: true, status: number, data: T }
 *   failure 402 → { ok: false, status: 402, error: PaymentRequiredPayload }
 *   failure other → { ok: false, status: number, error: ApiErrorPayload }
 *
 * Helper: \`isPaymentRequired(res)\` narrows failure to PaymentRequiredPayload.
 *
 * @module @xactions/api-client
 */

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  type?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PaymentRequiredPayload {
  x402Version?: number;
  accepts?: Array<{
    scheme?: string;
    network?: string;
    maxAmountRequired?: string;
    resource?: string;
    payTo?: string;
  }>;
  [key: string]: unknown;
}

export type ApiSuccess<T> = { ok: true; status: number; data: T };
export type ApiPaymentRequired = { ok: false; status: 402; error: PaymentRequiredPayload };
export type ApiFailure = { ok: false; status: number; error: ApiErrorPayload };

export type ApiResult<T> = ApiSuccess<T> | ApiPaymentRequired | ApiFailure;

/** Type guard — narrows failure response to x402 PaymentRequired */
export function isPaymentRequired(res: ApiResult<unknown>): res is ApiPaymentRequired {
  return !res.ok && res.status === 402;
}

export interface XActionsClientOptions {
  /** Base URL — defaults to https://xactions.app (production) or http://localhost:3001 when NODE_ENV=development */
  baseUrl?: string;
  /** bearerAuth — JWT for user-facing routes */
  bearerToken?: string;
  /** sessionCookie — X/Twitter auth_token cookie for pilot mounts */
  sessionCookie?: string;
  /** x402Payment — signed USDC payment payload for /api/ai/* routes */
  x402Payment?: string;
  /** a2aApiKey — X-Agent-API-Key for A2A/admin routes */
  a2aApiKey?: string;
  /** apiKey — X-API-Key alternate A2A key */
  apiKey?: string;
  /** Custom fetch implementation (useful for testing or proxy agents) */
  fetch?: typeof fetch;
  /** Additional headers to merge into every request */
  extraHeaders?: Record<string, string>;
}

export class XActionsClient {
  baseUrl: string;
  bearerToken?: string;
  sessionCookie?: string;
  x402Payment?: string;
  a2aApiKey?: string;
  apiKey?: string;
  extraHeaders: Record<string, string>;
  private _fetch: typeof fetch;

  constructor(opts: XActionsClientOptions = {}) {
    const rawUrl =
      opts.baseUrl ??
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
        ? 'http://localhost:3001'
        : 'https://xactions.app');
    this.baseUrl = rawUrl.replace(/\\/+$/, '');
    this.bearerToken = opts.bearerToken;
    this.sessionCookie = opts.sessionCookie;
    this.x402Payment = opts.x402Payment;
    this.a2aApiKey = opts.a2aApiKey;
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
    this._fetch = opts.fetch ?? (typeof globalThis !== 'undefined' && globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetch);
  }

  /**
   * Core request method — returns ApiResult<T>, never throws on HTTP errors.
   */
  async request<T = unknown>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const initHeaders: Record<string, string> =
      init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init.headers as Record<string, string> | undefined) ?? {};
    const headers = { ...this.extraHeaders, ...initHeaders };

    const res = await this._fetch(url, { ...init, headers });
    const status = res.status;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let body: unknown = undefined;
    if (text && ct.includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else if (text) {
      body = text;
    }

    if (status >= 200 && status < 300) {
      // Unbox canonical envelope {success:true, data:T} if present; handle nullish data cleanly
      const isEnvelope = typeof body === 'object' && body !== null && 'success' in body && 'data' in body;
      const data = isEnvelope ? (body as { data: T }).data : (body as T);
      return { ok: true, status, data };
    }

    // 402 → x402 PaymentRequired (NOT envelope)
    if (status === 402) {
      return { ok: false, status: 402, error: (body as PaymentRequiredPayload) ?? {} };
    }

    // Canonical envelope or raw error object
    const isObj = typeof body === 'object' && body !== null;
    const err = isObj && 'error' in (body as object) ? ((body as { error?: ApiErrorPayload }).error) : undefined;
    const errorPayload: ApiErrorPayload =
      err ??
      (isObj
        ? (body as ApiErrorPayload)
        : { code: 'INTERNAL', message: String(body ?? res.statusText) });

    return {
      ok: false,
      status,
      error: errorPayload,
    };
  }

${methodStubs}
}
`;

writeFileSync(resolve(outDir, 'client.ts'), clientTs, 'utf8');
console.log(`✅ Wrote ${resolve(outDir, 'client.ts')} (${ops.length} methods)`);

// ── Emit index.ts ──────────────────────────────────────────────────────────
const indexTs = `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * @xactions/api-client — typed client for the XActions API (Story 46.3).
 *
 * Re-exports the client class, ApiResult union, type guards, error payload types,
 * and the generated \`paths\`/\`components\`/\`operations\` types from schema.d.ts.
 */

export { XActionsClient, isPaymentRequired } from './client.js';
export type {
  XActionsClientOptions,
  ApiResult,
  ApiSuccess,
  ApiPaymentRequired,
  ApiFailure,
  ApiErrorPayload,
  PaymentRequiredPayload,
} from './client.js';
export type { paths, components, operations } from './schema.js';
`;

writeFileSync(resolve(outDir, 'index.ts'), indexTs, 'utf8');
console.log(`✅ Wrote ${resolve(outDir, 'index.ts')}`);

// ── Emit package.json with types condition ─────────────────────────────────
const pkgPath = resolve(outDir, 'package.json');
if (!existsSync(pkgPath) || force) {
  const pkg = {
    name: '@xactions/api-client',
    version: '0.1.0',
    description: 'Typed API client for XActions — generated from api/openapi.json (Story 46.3)',
    type: 'module',
    main: './index.ts',
    types: './index.ts',
    exports: {
      '.': {
        types: './index.ts',
        default: './index.ts',
      },
      './schema': {
        types: './schema.d.ts',
      },
      './client': {
        types: './client.ts',
        default: './client.ts',
      },
    },
    files: ['index.ts', 'client.ts', 'schema.d.ts', 'README.md'],
    scripts: {
      build: "echo 'no build step — ESM TS source'",
      typecheck: 'tsc --noEmit',
    },
    keywords: ['xactions', 'api-client', 'openapi', 'typescript'],
    license: 'Apache-2.0',
    author: 'nichxbt',
    peerDependencies: {},
    devDependencies: {
      typescript: '^5.9.3',
    },
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`✅ Wrote ${pkgPath}`);
} else {
  console.log(`⏭️  Skipped ${pkgPath} (exists — pass --force to overwrite)`);
}

// ── Emit tsconfig.json (idempotent) ────────────────────────────────────────
const tsconfigPath = resolve(outDir, 'tsconfig.json');
if (!existsSync(tsconfigPath) || force) {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowJs: false,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
    },
    include: ['./*.ts', './*.d.ts'],
  };
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n', 'utf8');
  console.log(`✅ Wrote ${tsconfigPath}`);
} else {
  console.log(`⏭️  Skipped ${tsconfigPath}`);
}

// ── Emit README.md (idempotent) ────────────────────────────────────────────
const readmePath = resolve(outDir, 'README.md');
if (!existsSync(readmePath) || force) {
  const readme = `# @xactions/api-client

Typed TypeScript client for the [XActions](https://xactions.app) API — generated from the committed OpenAPI 3.1 spec (\`api/openapi.json\`).

## Install

\`\`\`bash
# As a workspace/file dep
npm install @xactions/api-client@file:packages/api-client
\`\`\`

## Usage

\`\`\`ts
import { XActionsClient, isPaymentRequired } from '@xactions/api-client';
import type { paths, operations } from '@xactions/api-client/schema';

const client = new XActionsClient({
  baseUrl: 'https://xactions.app',
  sessionCookie: process.env.X_SESSION_COOKIE,   // for /api/viral, /api/crm, ...
  bearerToken: process.env.JWT,                  // for /api/auth, /api/user, ...
  x402Payment: process.env.X402_PAYMENT_HEADER,  // for /api/ai/*
});

// Typed call — method names come from operationId (post_api_viral_mine → postApiViralMine)
const res = await client.postApiViralMine({
  body: { platform: 'x', niche: 'saas', count: 500 },
});
if (res.ok) {
  console.log(res.data);   // T from the op's response schema
} else if (isPaymentRequired(res)) {
  // x402 PaymentRequired — NOT the canonical envelope
  console.log(res.error.accepts);
} else {
  console.error(res.error.code, res.error.message);
}
\`\`\`

## Auth schemes

| Constructor opt | Header | Used by |
|-----------------|--------|---------|
| \`bearerToken\` | \`Authorization: Bearer <jwt>\` | User-facing routes (/api/auth, /api/user, ...) |
| \`sessionCookie\` | \`x-session-cookie: <auth_token>\` | Pilot mounts (/api/viral, /api/crm, /api/optimizer, /api/checkpoints, /api/session) |
| \`x402Payment\` | \`X-PAYMENT: <signed payload>\` | Paid /api/ai/* endpoints |
| \`a2aApiKey\` | \`X-Agent-API-Key: <key>\` | A2A/admin routes |
| \`apiKey\` | \`X-API-Key: <key>\` | Alternate A2A header |

## Regenerating

\`\`\`bash
npm run build:openapi         # refresh api/openapi.json from generateSpec()
npm run generate:api-client   # regenerate schema.d.ts + method stubs
npm run generate:api-client -- --force   # also rewrite package.json/tsconfig/README
\`\`\`

The generator is deterministic — same \`openapi.json\` produces byte-identical output.
`;
  writeFileSync(readmePath, readme, 'utf8');
  console.log(`✅ Wrote ${readmePath}`);
} else {
  console.log(`⏭️  Skipped ${readmePath}`);
}

console.log(`\n✅ Generated @xactions/api-client — ${ops.length} ops, ${pathCount} paths`);
