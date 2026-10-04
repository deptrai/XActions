// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Browser Page Pool Spike — measure whether ONE shared browser can serve N
 * concurrent scrape jobs via page-acquisition instead of launch-per-job.
 *
 * Answers the spike questions (docs: spike-browser-page-pool.md):
 *   Q1  state isolation between pages (cookie/storage/UA/fingerprint)
 *   Q2  newPage() cost vs browser.launch() cost
 *   Q3  max concurrent pages before renderer contention (p95 latency)
 *   Q4  Obscura multi-page support on a single CDP connection
 *   Q5  page.close() does NOT kill the shared browser
 *   Q6  per-page proxy vs per-browser --proxy-server
 *   Q7  backpressure behaviour when pool is exhausted
 *
 * Modes:
 *   MODE=launch-per-job   baseline — current architecture (1 browser/job)
 *   MODE=pool-shared-context  1 browser, N pages share default context
 *   MODE=pool-isolated-context  1 browser, each job gets browserContext (incognito)
 *
 * Backends: BACKEND=chrome | obscura | both
 *
 * Usage:
 *   node scripts/browser-pool-spike.mjs                       # chrome, all modes, default N=4
 *   BACKEND=both N=8 node scripts/browser-pool-spike.mjs      # compare chrome vs obscura
 *   JOBS=20 POOL_SIZE=4 node scripts/browser-pool-spike.mjs   # 20 jobs through a 4-slot pool
 *
 * Env: OBSCURA_WS_ENDPOINT, PROXY_SERVER, HEADFUL=1, JOBS, POOL_SIZE, N (concurrency), MODE.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchStealthBrowser, createStealthPage, closeStealthBrowser } from '../src/scraping/stealthBrowser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'browser-pool-spike-results');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Config ──────────────────────────────────────────────────────────────────
export const IS_GATE = process.argv.includes('--gate') || process.env.VERIFY_GATE === '1';
const BACKEND   = process.env.BACKEND || (IS_GATE ? 'both' : 'chrome');
// Gate mode always runs pool-isolated-context — the scenario whose isolation
// guarantees the gate is actually verifying. MODE env is ignored under --gate.
const MODE      = IS_GATE ? 'pool-isolated-context'
                : (process.env.MODE || 'all');
// JOBS > POOL_SIZE so backpressure / queue wait (poolWaitMs) is exercised.
const JOBS      = Number(process.env.JOBS || (IS_GATE ? 8 : 8));        // total jobs to run
const POOL_SIZE = Number(process.env.POOL_SIZE || 4);   // max concurrent pages in pool modes
const PROXY     = process.env.PROXY_SERVER || undefined;

// Lightweight, deterministic target — measures engine overhead, not site JS.
const PROBE_URL = process.env.PROBE_URL || 'https://example.com';
// Cookie/state probe target — needs a page we can set+read state on.
const STATE_URL = process.env.STATE_URL || 'https://example.com';

// ─── Instrumentation ──────────────────────────────────────────────────────────
function memMB() {
  const m = process.memoryUsage();
  return { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) };
}
function percentiles(arr) {
  if (!arr.length) return {};
  const s = [...arr].sort((a, b) => a - b);
  const pick = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { p50: pick(50), p95: pick(95), p99: pick(99), min: s[0], max: s[s.length - 1], n: s.length };
}

// ─── Minimal BrowserPool (spike-local — NOT production) ──────────────────────
// Proves the pool pattern; production version lives in src/scraping/browserPool.js.
class SpikeBrowserPool {
  #browser; #backend; #isolated; #max; #active = 0; #queue = []; #contexts = new Set();
  constructor(browser, backend, { isolated = false, max = POOL_SIZE } = {}) {
    this.#browser = browser; this.#backend = backend; this.#isolated = isolated; this.#max = max;
  }
  stats() { return { active: this.#active, queued: this.#queue.length, max: this.#max }; }
  async acquire() {
    if (this.#active >= this.#max) {
      await new Promise((res) => this.#queue.push(res));   // Q7 backpressure: wait for a slot
    }
    this.#active++;
    const t0 = Date.now();
    let context = null;
    if (this.#isolated && typeof this.#browser.createBrowserContext === 'function') {
      context = await this.#browser.createBrowserContext();  // Q1/Q6 isolation boundary
      this.#contexts.add(context);
    }
    const ctxOrBrowser = context || this.#browser;
    const nativePage = await ctxOrBrowser.newPage();
    const pageMs = Date.now() - t0;
    nativePage.__poolContext = context;
    nativePage.__poolBackend = this.#backend;
    return { page: nativePage, pageMs };
  }
  async release(page) {
    try {
      const ctx = page.__poolContext;
      await page.close();                                    // Q5: close page, NOT browser
      if (ctx) { await ctx.close(); this.#contexts.delete(ctx); }
    } catch { /* noop */ }
    this.#active--;
    const next = this.#queue.shift();
    if (next) next();
  }
  async drain() { /* browser owned by caller */ }
}

// ─── One scrape "job" — goto + extract title + measure ───────────────────────
async function runJob(getPage, jobId, useStealthPage = false) {
  const t0 = Date.now();
  let page, pageMs = 0, release;
  if (getPage.mode === 'launch-per-job') {
    const browser = await launchStealthBrowser({ backend: getPage.backend, fallbackBackend: 'none', proxy: PROXY, headless: process.env.HEADFUL !== '1' });
    page = await createStealthPage(browser, { proxy: PROXY ? { url: PROXY } : undefined });
    release = async () => { await closeStealthBrowser(browser); };
    pageMs = Date.now() - t0;
  } else {
    const acq = await getPage.pool.acquire();
    page = acq.page; pageMs = acq.pageMs;
    release = async () => { await getPage.pool.release(page); };
  }
  try {
    const nav0 = Date.now();
    await page.goto(PROBE_URL, { waitUntil: getPage.backend === 'obscura' ? 'networkidle0' : 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    const navMs = Date.now() - nav0;
    return { jobId, ok: true, title, pageMs, navMs, totalMs: Date.now() - t0 };
  } catch (err) {
    return { jobId, ok: false, error: err.message, pageMs, totalMs: Date.now() - t0 };
  } finally {
    await release();
  }
}

// ─── Q1: state isolation probe ────────────────────────────────────────────────
async function probeIsolation(pool, backend) {
  const res = { backend, sharedContextLeak: null, isolatedContextLeak: null };
  const setCookie = async (page, name, val) => {
    await page.goto(STATE_URL, { waitUntil: backend === 'obscura' ? 'networkidle0' : 'domcontentloaded' });
    await page.evaluate((n, v) => { document.cookie = `${n}=${v}; path=/`; }, name, val);
  };
  const readCookie = async (page) => page.evaluate(() => document.cookie);

  // Shared context: page A sets, page B reads — leak = B sees A's cookie.
  {
    const a = await pool.acquire(); const b = await pool.acquire();
    await setCookie(a.page, 'xa_probe', 'A'); 
    const cookiesB = await (async () => { await b.page.goto(STATE_URL, { waitUntil: 'domcontentloaded' }); return readCookie(b.page); })();
    res.sharedContextLeak = /xa_probe=A/.test(cookiesB);
    await pool.release(a.page); await pool.release(b.page);
  }
  // Isolated context (Q1): same test across two browserContexts — should NOT leak.
  if (typeof pool === 'object' && pool.isolatedCapable) {
    const a = await pool.acquire(); const b = await pool.acquire();
    await setCookie(a.page, 'xa_probe_iso', 'A');
    const cookiesB = await (async () => { await b.page.goto(STATE_URL, { waitUntil: 'domcontentloaded' }); return readCookie(b.page); })();
    res.isolatedContextLeak = /xa_probe_iso=A/.test(cookiesB);
    await pool.release(a.page); await pool.release(b.page);
  }
  return res;
}

// ─── Scenario runner ──────────────────────────────────────────────────────────
async function scenario(backend, mode) {
  const out = { backend, mode, jobs: JOBS, poolSize: POOL_SIZE, results: [], metrics: {} };
  const tStart = Date.now();
  const memStart = memMB();

  if (mode === 'launch-per-job') {
    // Baseline: each job launches+closes its own browser. Bounded by POOL_SIZE concurrency.
    const sem = { n: 0, q: [] };
    const acquire = async () => { if (sem.n >= POOL_SIZE) await new Promise((r) => sem.q.push(r)); sem.n++; };
    const release = () => { sem.n--; sem.q.shift()?.(); };
    await Promise.all(Array.from({ length: JOBS }, async (_, i) => {
      await acquire();
      out.results.push(await runJob({ mode, backend }, i));
      release();
    }));
  } else {
    const isolated = mode === 'pool-isolated-context';
    const browser = await launchStealthBrowser({ backend, fallbackBackend: 'none', proxy: PROXY, headless: process.env.HEADFUL !== '1' });
    const pool = new SpikeBrowserPool(browser, backend, { isolated, max: POOL_SIZE });
    pool.isolatedCapable = isolated;
    // Q1 isolation probe only meaningful when we control context.
    out.isolation = await probeIsolation(pool, backend).catch((e) => ({ error: e.message }));
    const settled = await Promise.all(Array.from({ length: JOBS }, (_, i) => runJob({ mode, backend, pool }, i)));
    out.results.push(...settled);
    out.poolStats = pool.stats();
    await closeStealthBrowser(browser);   // teardown AFTER all pages released
  }

  out.metrics.wallMs = Date.now() - tStart;
  out.metrics.memStartMB = memStart.rss;
  out.metrics.memEndMB = memMB().rss;
  out.metrics.memDeltaMB = out.metrics.memEndMB - memStart.rss;
  const nav = out.results.filter((r) => r.ok).map((r) => r.navMs);
  const page = out.results.filter((r) => r.pageMs != null).map((r) => r.pageMs);
  out.metrics.navMs = percentiles(nav);
  out.metrics.pageAcquireMs = percentiles(page);
  out.metrics.succeeded = out.results.filter((r) => r.ok).length;
  out.metrics.failed = out.results.length - out.metrics.succeeded;
  return out;
}

/**
 * Evaluate whether the test runs satisfy the release verify gate criteria.
 * Criteria (AD-24, Story 53.6):
 * 1. No fatal crashes in any run.
 * 2. In isolated context mode, zero state leak across contexts (isolatedContextLeak === false).
 * 3. 100% of jobs succeed (failed === 0).
 *
 * @param {Array<Record<string, any>>} runs
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function evaluateGateConditions(runs) {
  const reasons = [];
  if (!Array.isArray(runs) || runs.length === 0) {
    return { pass: false, reasons: ['No runs were executed'] };
  }

  for (const r of runs) {
    const id = `${r.backend}/${r.mode}`;
    if (r.fatal) {
      reasons.push(`${id} encountered fatal error: ${r.fatal}`);
      continue;
    }

    // Reject malformed runs — a run without metrics or isolation data cannot
    // be positively verified, so it is a gate failure, not a silent pass.
    if (!r.metrics) {
      reasons.push(`${id} has no metrics — run result malformed, cannot verify`);
      continue;
    }

    if (r.isolation?.error) {
      reasons.push(`${id} isolation probe failed: ${r.isolation.error}`);
    } else if (r.mode === 'pool-isolated-context' && r.isolation?.isolatedContextLeak !== false) {
      reasons.push(`${id} failed isolation probe: isolatedContextLeak is ${r.isolation?.isolatedContextLeak} (expected false)`);
    }

    if (Number(r.metrics.failed) > 0) {
      reasons.push(`${id} had ${r.metrics.failed} failed jobs out of ${r.jobs}`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

// ─── Drive ────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const backends = BACKEND === 'both' ? ['chrome', 'obscura'] : [BACKEND];
  const modes = MODE === 'all'
    ? ['launch-per-job', 'pool-shared-context', 'pool-isolated-context']
    : [MODE];

  const allRuns = [];
  for (const backend of backends) {
    for (const mode of modes) {
      // Skip obscura isolated-context if createBrowserContext unsupported — record, don't crash.
      try {
        console.log(`\n▶ backend=${backend} mode=${mode} jobs=${JOBS} pool=${POOL_SIZE}`);
        const r = await scenario(backend, mode);
        allRuns.push(r);
        console.log(`   ✅ ${r.metrics.succeeded}/${r.jobs} ok | wall ${r.metrics.wallMs}ms | ΔRSS ${r.metrics.memDeltaMB}MB | nav p95 ${r.metrics.navMs?.p95 ?? '-'}ms | pageAcq p50 ${r.metrics.pageAcquireMs?.p50 ?? '-'}ms`);
        if (r.isolation) console.log(`   isolation: sharedLeak=${r.isolation.sharedContextLeak} isolatedLeak=${r.isolation.isolatedContextLeak}`);
      } catch (err) {
        allRuns.push({ backend, mode, fatal: err.message });
        console.log(`   ❌ FATAL ${err.message}`);
      }
    }
  }

  const report = path.join(OUT_DIR, `pool-spike-${Date.now()}.json`);
  fs.writeFileSync(report, JSON.stringify(allRuns, null, 2));
  console.log(`\nReport → ${report}`);

  // ─── Verdict summary (printed for quick read) ─────────────────────────────────
  console.log('\n═══ Pool spike verdict ═══');
  for (const r of allRuns) {
    if (r.fatal) { console.log(`  ${r.backend}/${r.mode}: FATAL ${r.fatal}`); continue; }
    const leak = r.isolation ? ` sharedLeak=${r.isolation.sharedContextLeak} isoLeak=${r.isolation.isolatedContextLeak}` : '';
    console.log(`  ${r.backend}/${r.mode.padEnd(22)} ok=${r.metrics.succeeded}/${r.jobs} ΔRSS=${r.metrics.memDeltaMB}MB navP95=${r.metrics.navMs?.p95 ?? '-'}ms${leak}`);
  }

  if (IS_GATE) {
    const gate = evaluateGateConditions(allRuns);
    if (gate.pass) {
      console.log('\n🎉 [VERIFY GATE PASS] All BrowserPool release criteria met.');
      process.exitCode = 0;
    } else {
      console.error('\n❌ [VERIFY GATE FAIL] BrowserPool release criteria failed:');
      for (const reason of gate.reasons) {
        console.error(`   - ${reason}`);
      }
      process.exitCode = 1;
    }
  }
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal error in browser-pool-spike:', err);
    process.exit(1);
  });
}
