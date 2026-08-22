// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Browser Script Runner (Puppeteer)
 *
 * Executes an XActions browser script server-side in an authenticated
 * Puppeteer session. This is the engine behind POST /api/scripts/run.
 *
 * Flow:
 *   1. Read script from disk (validated against SCRIPT_PRICES whitelist upstream)
 *   2. Patch common CONFIG keys with caller-supplied params
 *   3. Open authenticated Puppeteer page on x.com
 *   4. Inject params into window, evaluate script, capture output
 *   5. Abort gracefully on timeout; return logs + result
 *
 * @author nichxbt
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.resolve(__dirname, '../../../../src');

/** Maximum wall-clock time before the script is force-aborted. */
const SCRIPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * CONFIG keys that may be safely overridden via text substitution.
 * Only simple scalar values (boolean, number, string) are patched.
 */
const PATCHABLE_KEYS = new Set([
  'dryRun',
  'maxUnfollows', 'maxLikes', 'maxFollows', 'maxComments', 'maxPosts',
  'limit', 'count',
  'delayMs', 'minDelay', 'maxDelay',
  'keyword', 'hashtag', 'username',
]);

/**
 * Substitute caller-supplied param values into a script's CONFIG block.
 *
 * Only keys present in PATCHABLE_KEYS are touched; others are silently
 * ignored.  Substitution is intentionally simple — it replaces the value
 * on the first occurrence of `key: <value>` in the source text.
 *
 * @param {string} scriptCode
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function patchConfig(scriptCode, params) {
  let patched = scriptCode;
  for (const [key, value] of Object.entries(params)) {
    if (!PATCHABLE_KEYS.has(key)) continue;
    // Match `key: <anything up to the next comma, closing brace, or newline>`
    const re = new RegExp(`(\\b${key}\\s*:\\s*)([^,\\n}]+)`, 'g');
    patched = patched.replace(re, `$1${JSON.stringify(value)}`);
  }
  return patched;
}

/**
 * Resolve a validated script path to an absolute file path.
 * Throws if the resolved path escapes the src/ tree (path-traversal guard).
 *
 * @param {string} scriptPath
 * @returns {string}
 */
function resolveScriptPath(scriptPath) {
  if (scriptPath.startsWith('automation/')) {
    const name = scriptPath.slice('automation/'.length);
    const automationRoot = path.join(SRC_ROOT, 'automation');
    const filePath = path.resolve(automationRoot, `${name}.js`);
    if (!filePath.startsWith(automationRoot + path.sep)) {
      throw new Error('Invalid script path');
    }
    return filePath;
  }

  const name = scriptPath.startsWith('src/') ? scriptPath.slice(4) : scriptPath;
  const filePath = path.resolve(SRC_ROOT, `${name}.js`);
  if (!filePath.startsWith(SRC_ROOT + path.sep) && filePath !== SRC_ROOT) {
    throw new Error('Invalid script path');
  }
  return filePath;
}

/**
 * @typedef {object} RunBrowserScriptConfig
 * @property {string} scriptPath
 * @property {string} sessionCookie
 * @property {Record<string, unknown>} [params]
 * @property {string} [startUrl]
 */

/**
 * @typedef {object} ConsoleLogEntry
 * @property {string} type
 * @property {string} text
 * @property {number} ts
 */

/**
 * Run a single XActions browser script via Puppeteer.
 *
 * @param {RunBrowserScriptConfig} config
 * @param {(message: string) => void} updateProgress
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runBrowserScript(config, updateProgress, isCancelled) {
  const {
    scriptPath,
    sessionCookie,
    params = {},
    startUrl = 'https://x.com/home',
  } = config;

  updateProgress(`Loading script: ${scriptPath}`);

  const filePath = resolveScriptPath(scriptPath);
  const rawCode = await readFile(filePath, 'utf8');
  const patchedCode = patchConfig(rawCode, params);

  /** @type {Set<import('puppeteer').Browser> | undefined} */
  const activeBrowsers = globalThis.activeBrowsers;
  if (!activeBrowsers) {
    globalThis.activeBrowsers = new Set();
  }

  const browser = await puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  });

  globalThis.activeBrowsers?.add(browser);
  const page = await browser.newPage();

  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  /** @type {ConsoleLogEntry[]} */
  const logs = [];
  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text(), ts: Date.now() };
    logs.push(entry);
    updateProgress(msg.text());
  });
  page.on('pageerror', (err) => {
    logs.push({ type: 'error', text: (err instanceof Error ? err.message : String(err)), ts: Date.now() });
  });

  let scriptResult = null;

  try {
    await page.setCookie({
      name: 'auth_token',
      value: sessionCookie,
      domain: '.x.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    updateProgress(`Navigating to ${startUrl}`);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await page.evaluate((p) => {
      const w = /** @type {Window & typeof globalThis & { __XACTIONS_PARAMS__: Record<string, unknown> }} */ (window);
      w.__XACTIONS_PARAMS__ = p;
    }, params);

    updateProgress('Executing script…');

    const timeoutHandle = setTimeout(async () => {
      updateProgress('⏱️ Script timeout reached — aborting');
      try {
        await page.evaluate(() => {
          const w = /** @type {Window & typeof globalThis & { XActions?: { abort: () => void } }} */ (window);
          if (typeof w?.XActions?.abort === 'function') {
            w.XActions.abort();
          }
        });
      } catch { /* page may already be closing */ }
    }, SCRIPT_TIMEOUT_MS);

    try {
      scriptResult = await Promise.race([
        page.evaluate((code) => {
          return Promise.resolve(eval(code)); // eslint-disable-line no-eval
        }, patchedCode),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Script timed out')), SCRIPT_TIMEOUT_MS + 5_000)
        ),
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }

    updateProgress('✅ Script completed');

    return {
      success: true,
      script: scriptPath,
      params,
      result: scriptResult ?? null,
      logs,
    };
  } finally {
    await browser.close();
    globalThis.activeBrowsers?.delete(browser);
  }
}
