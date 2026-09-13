// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Obscura Spike — pluggable browser-backend smoke test.
 *
 * Proves that XActions' stealth layer works when Puppeteer talks CDP to an
 * Obscura engine (ws://127.0.0.1:9222) instead of launching Chrome. Exercises
 * a matrix of hard targets (bot walls + the real X SPA) and captures evidence
 * to scripts/obscura-spike-results/.
 *
 * Usage:
 *   obscura serve --port 9222 --stealth        # terminal 1
 *   node scripts/obscura-spike.mjs             # terminal 2 — Obscura backend
 *   BACKEND=chrome node scripts/obscura-spike.mjs   # Chrome baseline
 *   BACKEND=both   node scripts/obscura-spike.mjs   # side-by-side diff
 *
 * Env: OBSCURA_WS_ENDPOINT, PROXY_SERVER, HEADFUL=1, SHOTS=1, X_URL.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchStealthBrowser, createStealthPage } from '../src/scraping/stealthBrowser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'obscura-spike-results');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Test matrix — escalate from a static page to bot walls to the X SPA ─────
const TARGETS = [
  {
    name: 'example-static',
    url: 'https://example.com',
    expect: 'static HTML baseline',
    probe: async (page) => page.title(),
    pass: (r) => typeof r === 'string' && r.length > 0,
  },
  {
    name: 'cloudflare-challenge',
    url: 'https://nowsecure.nl/',
    expect: 'Cloudflare interstitial — hardest common bot wall',
    probe: async (page) => ({ title: await page.title(), bodyLen: (await page.content()).length }),
    pass: (r) => r.title && !/just a moment|checking your browser|attention required/i.test(r.title),
  },
  {
    name: 'fingerprint-sannysoft',
    url: 'https://bot.sannysoft.com/',
    expect: 'webdriver/fingerprint leakage report page',
    probe: async (page) => page.evaluate(() => ({
      webdriver: navigator.webdriver,
      languages: navigator.languages,
      platform: navigator.platform,
      plugins: navigator.plugins.length,
    })),
    pass: (r) => r.webdriver === false,
  },
  {
    name: 'xcom-guest',
    url: process.env.X_URL || 'https://x.com/nichxbt',
    expect: 'real X SPA — React + heavy CSS + auth-wall behaviour',
    probe: async (page) => page.evaluate(() => ({
      title: document.title,
      articles: document.querySelectorAll('article[data-testid="tweet"]').length,
      primaryColumn: !!document.querySelector('[data-testid="primaryColumn"]'),
      bodyLen: document.body ? document.body.innerHTML.length : 0,
    })),
    pass: (r) => r.bodyLen > 1000 && !/something went wrong|javascript is disabled/i.test(r.title || ''),
  },
];

async function probeBackend(backend) {
  const summary = { backend, startedAt: new Date().toISOString(), targets: [] };
  let browser;
  try {
    browser = await launchStealthBrowser({
      backend,
      wsEndpoint: process.env.OBSCURA_WS_ENDPOINT,
      proxy: process.env.PROXY_SERVER || undefined,
      headless: process.env.HEADFUL !== '1',
      fingerprint: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US', platform: 'MacIntel',
        viewport: { width: 1440, height: 900 },
        timezone: 'America/New_York',
        hardwareConcurrency: 8, deviceMemory: 8,
        webgl: { vendor: 'Intel Inc.', renderer: 'Intel Iris OpenGL Engine' },
      },
    });
  } catch (err) {
    summary.fatal = `launch failed: ${err.message}`;
    return summary;
  }

  for (const t of TARGETS) {
    const rec = { name: t.name, url: t.url, expect: t.expect };
    try {
      const page = await createStealthPage(browser, {
        fingerprint: browser.__fingerprint,
        proxy: process.env.PROXY_SERVER ? { url: process.env.PROXY_SERVER } : undefined,
      });
      const t0 = Date.now();
      // NOTE: Obscura 0.2.2 never settles 'networkidle2' (hangs) — use networkidle0.
      await page.goto(t.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await sleep(2500); // let SPA/bot-wall settle
      const result = await t.probe(page);
      rec.ok = t.pass(result);
      rec.ms = Date.now() - t0;
      rec.result = JSON.stringify(result).slice(0, 500);
      if (process.env.SHOTS === '1') {
        const file = path.join(OUT_DIR, `${backend}-${t.name}.png`);
        try { await page.screenshot({ path: file, fullPage: true }); rec.shot = file; } catch (e) { rec.shotErr = e.message; }
      }
      await page.close();
    } catch (err) {
      rec.ok = false;
      rec.error = err.message;
    }
    summary.targets.push(rec);
  }
  try { await (backend === 'obscura' ? browser.disconnect() : browser.close()); } catch { /* noop */ }
  summary.finishedAt = new Date().toISOString();
  return summary;
}

// Optional: auto-spawn `obscura serve` when binary is provided
async function withObscuraServer(fn) {
  const bin = process.env.OBSCURA_BIN;
  if (!bin) return fn(); // assume user already runs `obscura serve`
  const args = ['serve', '--port', '9222', '--stealth', '--allow-private-network'];
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(`[obscura] ${d}`));
  await sleep(1500); // wait for ws listener
  try { return await fn(); } finally { proc.kill('SIGTERM'); }
}

const backend = process.env.BACKEND || 'obscura';
fs.mkdirSync(OUT_DIR, { recursive: true });

const runs = backend === 'both' ? ['chrome', 'obscura'] : [backend];
const all = await withObscuraServer(async () => {
  const out = [];
  for (const b of runs) out.push(await probeBackend(b));
  return out;
});

const report = path.join(OUT_DIR, `report-${Date.now()}.json`);
fs.writeFileSync(report, JSON.stringify(all, null, 2));

console.log('\n═══ Obscura spike results ═══');
for (const s of all) {
  console.log(`\n■ backend=${s.backend}${s.fatal ? `  FATAL: ${s.fatal}` : ''}`);
  for (const t of s.targets) {
    console.log(`  ${t.ok ? '✅' : '❌'} ${t.name.padEnd(22)} ${t.ms ? t.ms + 'ms' : ''}  ${t.error || t.result || ''}`);
  }
}
console.log(`\nReport → ${report}`);
