// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 54.0 — Ingestion Coverage Spike
 * Live-probe verification that X search returns tweets for crypto queries
 * (cashtags, contract addresses, token names, KOL timelines) and that
 * Dexscreener has liquidity/volume data for the watchlist.
 *
 * This is a MEASUREMENT script — no production logic. Output feeds the
 * GO/REDESIGN verdict for Stories 54.1–54.4.
 *
 * Measurements (per epic AC):
 *   M1  ≥10 queries: 3 cashtags, 3 Solana contracts, 2 token names, 2 KOL timelines
 *       → per-query: count, recency spread, unique authors, full_text presence
 *   M2  ≥5 watchlist tokens via dexscreener token_lookup
 *       → % with liquidity_usd, % with volume_24h  (<50% → 54.3 redesign)
 *   M3  Poll ceiling: sustainable queries per window before degrade
 *       → input for setPlatformLimit('twitter')
 *   M4  Auth-path detection: auth session vs guest (search is auth-only since
 *       2026-09; XACT_4010 thrown without auth_token)
 *
 * Usage:
 *   node scripts/spike-54-coverage.mjs                    # full run, all phases
 *   PHASES=search,dex,ceiling node scripts/spike-54-coverage.mjs
 *   QUERIES_JSON='[{"type":"cashtag","query":"$PEPE"}]' node scripts/spike-54-coverage.mjs
 *   CEILING_MAX=20 CEILING_WINDOW_MS=600000 node scripts/spike-54-coverage.mjs
 *
 * Env: MEDIRUS_SESSION_COOKIE (auth_token value or full cookie string),
 *      MEDIRUS_CSRF_TOKEN (optional ct0), PROXY_SERVER (optional).
 *
 * Output: implementation-artifacts/spike-54-coverage-report.md + raw JSON in
 *         scripts/spike-54-coverage-results/
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const OUT_DIR = path.join(__dirname, 'spike-54-coverage-results');
const REPORT_PATH = path.join(ROOT, '_bmad-output', 'implementation-artifacts', 'spike-54-coverage-report.md');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ─── Config ──────────────────────────────────────────────────────────────────
const PHASES = (process.env.PHASES || 'search,dex,ceiling').split(',').map((s) => s.trim());
const SEARCH_LIMIT = Number(process.env.SEARCH_LIMIT || 25);
const CEILING_MAX = Number(process.env.CEILING_MAX || 30);          // cap probe iterations
const CEILING_WINDOW_MS = Number(process.env.CEILING_WINDOW_MS || 600_000); // 10 min
const QUERY_GAP_MS = Number(process.env.QUERY_GAP_MS || 4000);      // polite spacing in ceiling probe
const SESSION_COOKIE = process.env.MEDIRUS_SESSION_COOKIE || '';
const CSRF_TOKEN = process.env.MEDIRUS_CSRF_TOKEN || '';

// Default query set — overridable via QUERIES_JSON.
const DEFAULT_QUERIES = [
  { type: 'cashtag',   query: '$PEPE' },
  { type: 'cashtag',   query: '$WIF' },
  { type: 'cashtag',   query: '$BONK' },
  // Solana mints — real contracts on mainnet
  { type: 'contract',  query: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },   // BONK
  { type: 'contract',  query: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },   // WIF
  { type: 'contract',  query: 'So11111111111111111111111111111111111111112' },    // WSOL (control: huge cap)
  { type: 'tokenname', query: 'Pepe coin' },
  { type: 'tokenname', query: 'dogwifhat' },
  { type: 'kol_timeline', query: 'from:VitalikButerin',  note: 'KOL timeline read' },
  { type: 'kol_timeline', query: 'from:aeyakovenko',     note: 'KOL timeline read (Solana)' },
];

// Dexscreener watchlist — overridable via DEX_TOKENS_JSON.
const DEFAULT_DEX_TOKENS = [
  { label: 'BONK',  chain: 'solana', contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { label: 'WIF',   chain: 'solana', contract: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { label: 'WSOL',  chain: 'solana', contract: 'So11111111111111111111111111111111111111112' },
  { label: 'POPCAT',chain: 'solana', contract: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
  { label: 'MEW',   chain: 'solana', contract: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' },
];

const parseEnvJson = (envVal, fallback, name) => {
  if (!envVal) return fallback;
  try { return JSON.parse(envVal); }
  catch (e) { console.warn(`⚠️  ${name} invalid JSON (${e.message}) — using defaults`); return fallback; }
};
const QUERIES = parseEnvJson(process.env.QUERIES_JSON, DEFAULT_QUERIES, 'QUERIES_JSON');
const DEX_TOKENS = parseEnvJson(process.env.DEX_TOKENS_JSON, DEFAULT_DEX_TOKENS, 'DEX_TOKENS_JSON');

// ─── Results accumulator ─────────────────────────────────────────────────────
const results = {
  startedAt: new Date().toISOString(),
  auth: { cookiePresent: Boolean(SESSION_COOKIE), csrfPresent: Boolean(CSRF_TOKEN), path: 'unknown' },
  search: { queries: [], summary: {} },
  dexscreener: { tokens: [], summary: {} },
  ceiling: { samples: [], ceiling: null, degradedAt: null },
  verdicts: {},
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const RESULTS_PATH = path.join(OUT_DIR, 'results.json');
// Resume-friendly: merge into an existing results file so partial-phase runs
// (search only, dex only, ceiling only) accumulate instead of overwriting.
try {
  const prev = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  for (const [k, v] of Object.entries(prev)) {
    if (k === 'search' || k === 'dexscreener' || k === 'ceiling') {
      if (v && typeof v === 'object' && Object.keys(v).length) results[k] = { ...results[k], ...v };
    } else if (k === 'auth') {
      // keep freshest auth detection; don't regress a populated prior value
      if (!results.auth.cookiePresent && v.cookiePresent) results.auth = v;
    }
  }
} catch { /* fresh run */ }
const saveRaw = () => fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));

// ─── Loader: production call path (scrape() → crawler → governor) ────────────
let scrape;
async function loadScrape() {
  const mod = await import(path.join(ROOT, 'src/scrapers/index.js'));
  scrape = mod.scrape;
  return scrape;
}

function buildCookies() {
  // descriptor.createSession(options) reads options.cookies|authCookie|authToken
  // (NOT options.session) — cookie must ride on the scrape() options object.
  if (!SESSION_COOKIE) return '';
  if (SESSION_COOKIE.includes('auth_token=')) return SESSION_COOKIE;
  const csrf = CSRF_TOKEN ? `; ct0=${CSRF_TOKEN}` : '';
  return `auth_token=${SESSION_COOKIE}${csrf}`;
}

// ─── M1: search coverage probe ───────────────────────────────────────────────
async function probeSearch() {
  console.log('\n═══ M1: X Search coverage probe ═══');
  results.search = { queries: [], summary: {} };
  const cookies = buildCookies();
  const cookieFilePath = path.join(process.env.HOME ?? '~', '.medirus', 'cookies.json');
  if (SESSION_COOKIE) {
    results.auth.path = 'auth_session (MEDIRUS_SESSION_COOKIE env)';
  } else if (fs.existsSync(cookieFilePath)) {
    results.auth.path = 'auth_session (~/.medirus/cookies.json fallback)';
  } else {
    results.auth.path = 'no_session';
  }

  for (const q of QUERIES) {
    const t0 = now();
    const entry = { ...q, ok: false, error: null, count: 0, latencyMs: 0, recency: null, uniqueAuthors: 0, hasFullText: false, authError: false };
    try {
      const res = await scrape('twitter', 'search', {
        query: q.query,
        limit: SEARCH_LIMIT,
        cookies,
      });
      const posts = res?.posts ?? res?.items ?? (Array.isArray(res) ? res : []);
      entry.count = posts.length;
      entry.latencyMs = now() - t0;
      entry.ok = true;

      if (posts.length > 0) {
        const ts = posts.map((p) => new Date(p.publishedAt ?? p.ts ?? p.createdAt ?? p.timestamp ?? 0).getTime()).filter(Boolean);
        if (ts.length) {
          entry.recency = { newest: new Date(Math.max(...ts)).toISOString(), oldest: new Date(Math.min(...ts)).toISOString() };
        }
        const authors = new Set(posts.map((p) => p.author ?? p.username ?? p.authorUsername).filter(Boolean));
        entry.uniqueAuthors = authors.size;
        entry.hasFullText = posts.some((p) => typeof (p.text ?? p.full_text ?? p.content) === 'string' && (p.text ?? p.full_text ?? p.content).length > 0);
      }
    } catch (err) {
      entry.error = `${err?.code ?? ''} ${err?.message ?? err}`.slice(0, 300);
      entry.latencyMs = now() - t0;
      if (String(entry.error).includes('XACT_4010') || /auth|401/i.test(entry.error)) entry.authError = true;
      entry.ok = false;
    }
    results.search.queries.push(entry);
    console.log(`  ${q.type.padEnd(13)} ${q.query.slice(0, 44).padEnd(44)} → ${entry.ok ? `${entry.count} results` : `ERR ${entry.error?.slice(0, 80)}`}`);
    saveRaw();
    await sleep(QUERY_GAP_MS);
  }

  const byType = (t) => results.search.queries.filter((e) => e.type === t);
  const nonEmpty = (arr) => arr.filter((e) => e.ok && e.count > 0);
  results.search.summary = {
    total: results.search.queries.length,
    ok: results.search.queries.filter((e) => e.ok).length,
    nonEmpty: nonEmpty(results.search.queries).length,
    cashtagHitRate: (() => { const a = byType('cashtag'); return a.length ? nonEmpty(a).length / a.length : null; })(),
    contractHitRate: (() => { const a = byType('contract'); return a.length ? nonEmpty(a).length / a.length : null; })(),
    tokennameHitRate: (() => { const a = byType('tokenname'); return a.length ? nonEmpty(a).length / a.length : null; })(),
    kolHitRate: (() => { const a = byType('kol_timeline'); return a.length ? nonEmpty(a).length / a.length : null; })(),
    authErrors: results.search.queries.filter((e) => e.authError).length,
  };
  console.log('  summary:', JSON.stringify(results.search.summary));
}

// ─── M2: dexscreener coverage cross-check ────────────────────────────────────
async function probeDex() {
  console.log('\n═══ M2: Dexscreener watchlist cross-check ═══');
  results.dexscreener = { tokens: [], summary: {} };
  for (const tok of DEX_TOKENS) {
    const t0 = now();
    const entry = { ...tok, ok: false, error: null, hasLiquidity: false, hasVolume24h: false, liquidityUsd: null, volume24h: null, latencyMs: 0 };
    try {
      const res = await scrape('dexscreener', 'token_lookup', {
        chain: tok.chain,
        contract: tok.contract,
        token: tok.contract,
        address: tok.contract,
      });
      // Real shape: res.data.pairs[] with flat liquidity_usd / volume_24h fields.
      // Take the deepest-liquidity pair as the token's liquidity anchor.
      const pairs = res?.data?.pairs ?? res?.pairs ?? (Array.isArray(res) ? res : []);
      const best = (Array.isArray(pairs) ? pairs : []).reduce(
        (acc, p) => ((p?.liquidity_usd ?? 0) > (acc?.liquidity_usd ?? 0) ? p : acc),
        null,
      );
      const liq = best?.liquidity_usd ?? null;
      const vol = best?.volume_24h ?? null;
      entry.pairCount = res?.data?.pair_count ?? (Array.isArray(pairs) ? pairs.length : 0);
      entry.liquidityUsd = liq;
      entry.volume24h = vol;
      entry.hasLiquidity = typeof liq === 'number' && liq > 0;
      entry.hasVolume24h = typeof vol === 'number' && vol > 0;
      entry.latencyMs = now() - t0;
      entry.ok = true;
    } catch (err) {
      entry.error = `${err?.code ?? ''} ${err?.message ?? err}`.slice(0, 300);
      entry.latencyMs = now() - t0;
      entry.ok = false;
    }
    results.dexscreener.tokens.push(entry);
    console.log(`  ${tok.label.padEnd(8)} ${tok.contract.slice(0, 20)}… → ${entry.ok ? `liq=${entry.liquidityUsd ?? 'n/a'} vol24h=${entry.volume24h ?? 'n/a'}` : `ERR ${entry.error?.slice(0, 80)}`}`);
    saveRaw();
    await sleep(QUERY_GAP_MS);
  }

  const n = results.dexscreener.tokens.length;
  const ok = results.dexscreener.tokens.filter((e) => e.ok).length;
  results.dexscreener.summary = {
    total: n,
    ok,
    pctLiquidity: n ? results.dexscreener.tokens.filter((e) => e.hasLiquidity).length / n : null,
    pctVolume24h: n ? results.dexscreener.tokens.filter((e) => e.hasVolume24h).length / n : null,
  };
  console.log('  summary:', JSON.stringify(results.dexscreener.summary));
}

// ─── M3: poll ceiling probe ──────────────────────────────────────────────────
async function probeCeiling() {
  console.log('\n═══ M3: X search poll-ceiling probe ═══');
  results.ceiling = { samples: [], ceiling: null, degradedAt: null };
  const cookies = buildCookies();
  const probeQuery = process.env.CEILING_QUERY || '$PEPE';
  const started = now();
  let sent = 0;
  let degraded = false;

  while (sent < CEILING_MAX && now() - started < CEILING_WINDOW_MS && !degraded) {
    const t0 = now();
    const sample = { n: sent + 1, t: now(), ok: false, count: 0, latencyMs: 0, error: null };
    try {
      const res = await scrape('twitter', 'search', { query: probeQuery, limit: 5, cookies });
      const posts = res?.posts ?? res?.items ?? (Array.isArray(res) ? res : []);
      sample.count = posts.length;
      sample.ok = true;
      if (posts.length === 0) {
        degraded = true; // first empty = degrade signal
        results.ceiling.degradedAt = `empty_result_at_${sent + 1}`;
      }
    } catch (err) {
      sample.error = `${err?.code ?? ''} ${err?.message ?? err}`.slice(0, 200);
      // rate-limit or auth-degrade → ceiling reached
      if (/rate|limit|429|throttl|XACT_4/i.test(sample.error)) {
        degraded = true;
        results.ceiling.degradedAt = `error_at_${sent + 1}: ${sample.error.slice(0, 80)}`;
      }
    }
    sample.latencyMs = now() - t0;
    results.ceiling.samples.push(sample);
    sent++;
    saveRaw();
    await sleep(QUERY_GAP_MS);
  }

  const elapsedMs = now() - started;
  results.ceiling.ceiling = {
    queriesSent: sent,
    elapsedMs,
    queriesPer10Min: elapsedMs > 0 ? Math.round((sent / elapsedMs) * 600_000 * 10) / 10 : null,
    degraded: results.ceiling.degradedAt !== null,
    note: 'Sustainable rate = sent count before first degrade; conservative ceiling = min(this, governor platform limit)',
  };
  console.log(`  sent=${sent} degradedAt=${results.ceiling.degradedAt ?? 'none'} rate≈${results.ceiling.ceiling.queriesPer10Min} q/10min`);
}

// ─── Verdicts ────────────────────────────────────────────────────────────────
function computeVerdicts() {
  const s = results.search.summary;
  const d = results.dexscreener.summary;
  const c = results.ceiling.ceiling;

  const v = {};

  // 54.1 extractor — needs tweets to extract FROM
  v['54.1'] = (s.ok ?? 0) > 0 && (s.nonEmpty ?? 0) >= Math.ceil((s.total ?? 1) * 0.5)
    ? 'GO — search returns data for ≥50% of probe queries'
    : 'REDESIGN — search coverage too sparse for entity extraction';

  // 54.2 pipeline — needs recurring data + a viable strategy
  const contractBlind = (s.contractHitRate ?? 0) < 0.5;
  const cashtagWeak = (s.cashtagHitRate ?? 0) < 0.3;
  if ((s.nonEmpty ?? 0) <= 0) {
    v['54.2'] = 'REDESIGN — no recurring mention stream possible';
  } else if (contractBlind) {
    v['54.2'] = 'GO (fork) — contract-address search is blind → switch 54.2 to KOL-timeline monitor + token extraction strategy';
  } else {
    v['54.2'] = 'GO — global search path viable';
  }

  // 54.3 hype metrics — needs dexscreener liquidity data
  v['54.3'] = (d.pctLiquidity ?? 0) >= 0.5
    ? `GO — ${Math.round((d.pctLiquidity ?? 0) * 100)}% of watchlist has liquidity_usd`
    : `REDESIGN — only ${Math.round((d.pctLiquidity ?? 0) * 100)}% liquidity coverage (<50% threshold) → normalize by unique_sources only`;

  // 54.4 mindshare — needs cashtag/name coverage above floor
  v['54.4'] = cashtagWeak
    ? `GO (scoped) — cashtag hit-rate ${(s.cashtagHitRate ?? 0).toFixed(2)} < 0.30 → scope mindshare to watched-token share, not global`
    : `GO — cashtag coverage ${(s.cashtagHitRate ?? 0).toFixed(2)} supports watchlist-share mindshare`;

  if ((s.authErrors ?? 0) > 0) {
    for (const k of Object.keys(v)) v[k] += ` [caveat: ${s.authErrors} queries hit auth errors — session path degraded]`;
  }
  if (c && c.queriesPer10Min != null) {
    v.ceiling = `Poll ceiling ≈ ${c.queriesPer10Min} queries/10min (sent ${c.queriesSent}, degraded=${c.degraded}) — feed to setPlatformLimit('twitter')`;
  }
  results.verdicts = v;
}

// ─── Report writer ───────────────────────────────────────────────────────────
function writeReport() {
  const s = results.search.summary;
  const d = results.dexscreener.summary;
  const c = results.ceiling.ceiling;

  const qRows = results.search.queries.map((e) =>
    `| ${e.type} | \`${e.query.slice(0, 40)}\` | ${e.ok ? 'ok' : 'ERR'} | ${e.count} | ${e.uniqueAuthors} | ${e.hasFullText ? 'yes' : 'no'} | ${e.recency ? `${e.recency.oldest.slice(0, 10)}→${e.recency.newest.slice(0, 10)}` : '—'} | ${e.latencyMs} | ${e.error ? e.error.slice(0, 50) : ''} |`
  ).join('\n');

  const dRows = results.dexscreener.tokens.map((e) =>
    `| ${e.label} | \`${e.contract.slice(0, 16)}…\` | ${e.ok ? 'ok' : 'ERR'} | ${e.liquidityUsd ?? '—'} | ${e.volume24h ?? '—'} | ${e.latencyMs} |`
  ).join('\n');

  const md = `# Spike 54.0 — Ingestion Coverage Report

> Generated: ${new Date().toISOString()}
> Runner: \`scripts/spike-54-coverage.mjs\` (phases: ${PHASES.join(', ')})
> Auth path: **${results.auth.path}** (cookie=${results.auth.cookiePresent}, csrf=${results.auth.csrfPresent})

## Verdicts (per story)

| Story | Verdict |
|---|---|
| 54.1 TokenEntityExtractor | ${results.verdicts['54.1']} |
| 54.2 TokenMentionPipeline | ${results.verdicts['54.2']} |
| 54.3 Hype-vs-Liquidity | ${results.verdicts['54.3']} |
| 54.4 Token Mindshare | ${results.verdicts['54.4']} |
| Poll ceiling | ${results.verdicts.ceiling ?? 'not measured'} |

## M1 — X Search coverage (${s.nonEmpty}/${s.total} non-empty, ${s.authErrors} auth errors)

| Type | Query | Status | Count | UniqAuthors | FullText | Recency | ms | Error |
|---|---|---|---|---|---|---|---|---|
${qRows}

Hit rates: cashtag=${(s.cashtagHitRate ?? 0).toFixed(2)} contract=${(s.contractHitRate ?? 0).toFixed(2)} tokenname=${(s.tokennameHitRate ?? 0).toFixed(2)} kol=${(s.kolHitRate ?? 0).toFixed(2)}

## M2 — Dexscreener watchlist (${d.ok}/${d.total} lookups ok)

| Token | Contract | Status | liquidityUsd | volume24h | ms |
|---|---|---|---|---|---|
${dRows}

Coverage: liquidity=${Math.round((d.pctLiquidity ?? 0) * 100)}% volume24h=${Math.round((d.pctVolume24h ?? 0) * 100)}%  (threshold: ≥50% for 54.3 GO)

## M3 — Poll ceiling

${c ? `Sent **${c.queriesSent}** queries in ${(c.elapsedMs / 1000).toFixed(0)}s → **≈${c.queriesPer10Min} queries/10min** sustainable. Degraded at: ${results.ceiling.degradedAt ?? 'never (hit CEILING_MAX or window end)'}. Recommendation: \`setPlatformLimit('twitter', { safeRequestsPerMinute: ${Math.max(1, Math.floor((c.queriesPer10Min ?? 10) / 10))} })\` pending confirmation.` : 'Not measured.'}

## Decision forks (verbatim from epic)

- contract-address search blind → 54.2 switches to "KOL-timeline monitor + token extraction" instead of global search: **${(s.contractHitRate ?? 0) < 0.5 ? 'TRIGGERED' : 'not triggered'}**
- cashtag coverage <30% for small tokens → mindshare scoped to watched-token share: **${(s.cashtagHitRate ?? 0) < 0.3 ? 'TRIGGERED' : 'not triggered'}**

## Raw data

\`scripts/spike-54-coverage-results/results.json\`
`;

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, md);
  console.log(`\n📄 report → ${REPORT_PATH}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Spike 54.0 — ingestion coverage measurement');
  console.log(`phases=${PHASES.join(',')} authCookie=${results.auth.cookiePresent} queries=${QUERIES.length} dexTokens=${DEX_TOKENS.length}`);
  await loadScrape();
  if (PHASES.includes('search')) await probeSearch();
  if (PHASES.includes('dex')) await probeDex();
  if (PHASES.includes('ceiling')) await probeCeiling();
  computeVerdicts();
  saveRaw();
  writeReport();
  console.log('\nDone. Verdicts:');
  for (const [k, v] of Object.entries(results.verdicts)) console.log(`  ${k}: ${v}`);
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err);
  saveRaw();
  try { writeReport(); } catch { /* report best-effort */ }
  process.exit(1);
});
