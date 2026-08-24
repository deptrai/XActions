// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

/**
 * Resolve Chrome executable path based on platform.
 *
 * @param {string} [platform=process.platform]
 * @param {string|null} [customPath=null]
 * @returns {string} Executable path or binary name
 */
export function getChromeExecutablePath(platform = process.platform, customPath = null) {
  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new PlatformError({
        code: 'XACT_5030',
        type: ErrorTypes.INTERNAL,
        message: `[CDP ERROR] Chrome not found at ${customPath}. Install Chrome or set --chrome-path.`,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      });
    }
    return customPath;
  }

  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || 'C:\\Users\\Default\\AppData\\Local';

    const candidates = [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  // linux
  const linuxCandidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const cand of linuxCandidates) {
    return cand; // in PATH
  }
  return 'google-chrome';
}

/**
 * Get dedicated default user data dir for CDP session.
 * Ensures directory exists with 0o700 permission.
 *
 * @param {string} [platform=process.platform]
 * @returns {string}
 */
export function getDefaultUserDataDir(platform = process.platform) {
  const dir = path.join(os.homedir(), '.xactions', 'chrome-profile');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch {}
  return dir;
}

/**
 * Build Chrome launch arguments.
 *
 * @param {Object} [options={}]
 * @param {number} [options.port=9222]
 * @param {string} [options.userDataDir]
 * @param {boolean} [options.headless=false]
 * @returns {string[]}
 */
export function buildChromeArgs(options = {}) {
  const port = options.port || 9222;
  const userDataDir = options.userDataDir || getDefaultUserDataDir();
  const headless = Boolean(options.headless);

  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (headless) {
    args.push('--headless=new');
  }

  return args;
}

/**
 * Query /json/version on CDP endpoint and extract webSocketDebuggerUrl.
 *
 * @param {string} [cdpUrl='http://127.0.0.1:9222']
 * @param {Object} [options={}]
 * @param {number} [options.retries=1]
 * @param {number} [options.delayMs=100]
 * @returns {Promise<string>}
 */
export async function fetchCdpWsEndpoint(cdpUrl = 'http://127.0.0.1:9222', options = {}) {
  const retries = options.retries ?? 1;
  const delayMs = options.delayMs ?? 100;
  const normalizedUrl = /^https?:\/\//i.test(cdpUrl) ? cdpUrl : `http://${cdpUrl}`;
  const baseUrl = normalizedUrl.replace(/\/+$/, '');
  const versionUrl = `${baseUrl}/json/version`;

  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data.webSocketDebuggerUrl) {
          return data.webSocketDebuggerUrl;
        }
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const portMatch = baseUrl.match(/:(\d+)$/);
  const port = portMatch ? portMatch[1] : '9222';

  throw new PlatformError({
    code: 'XACT_5030',
    type: ErrorTypes.INTERNAL,
    message: `[CDP ERROR] Could not connect to Chrome on port ${port}. Run 'xactions auth --launch-chrome' first.`,
    suggestedAction: SuggestedActions.RELOGIN,
    cause: lastError,
    details: { cdpUrl, versionUrl },
  });
}

/**
 * Launch Chrome with remote debugging port.
 *
 * @param {Object} [options={}]
 * @param {number} [options.port=9222]
 * @param {string} [options.userDataDir]
 * @param {string} [options.chromePath]
 * @param {boolean} [options.headless=false]
 * @returns {Promise<{ port: number, cdpUrl: string, userDataDir: string, alreadyRunning?: boolean }>}
 */
export async function launchChrome(options = {}) {
  const port = Number(options.port) || 9222;
  const userDataDir = options.userDataDir || getDefaultUserDataDir();
  const cdpUrl = `http://127.0.0.1:${port}`;

  // Check if already active
  try {
    const ws = await fetchCdpWsEndpoint(cdpUrl, { retries: 1, delayMs: 50 });
    if (ws) {
      return {
        port,
        cdpUrl,
        userDataDir,
        alreadyRunning: true,
      };
    }
  } catch {}

  const executablePath = getChromeExecutablePath(process.platform, options.chromePath || null);
  const args = buildChromeArgs({
    port,
    userDataDir,
    headless: options.headless,
  });

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();

  // Poll until endpoint responds
  try {
    await fetchCdpWsEndpoint(cdpUrl, { retries: 25, delayMs: 400 });
  } catch (err) {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {}
    }
    throw new PlatformError({
      code: 'XACT_5030',
      type: ErrorTypes.INTERNAL,
      message: `[CDP ERROR] Chrome process spawned but CDP port ${port} did not become ready.`,
      suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      cause: err,
    });
  }

  return {
    port,
    cdpUrl,
    userDataDir,
    alreadyRunning: false,
  };
}

/**
 * Connect adapter (Playwright or Puppeteer) to Chrome via CDP.
 *
 * @param {string} [cdpUrl='http://127.0.0.1:9222']
 * @param {Object} [options={}]
 * @param {any} [options.adapter]
 * @param {boolean} [options.preserveProfile=true]
 * @returns {Promise<any>}
 */
export async function launchBrowserWithCdp(cdpUrl = 'http://127.0.0.1:9222', options = {}) {
  try {
    let adapter = options.adapter;
    if (!adapter) {
      const { getAdapter } = await import('../scrapers/adapters/index.js');
      adapter = await getAdapter();
    }

    const browser = await adapter.connect(cdpUrl, {
      preserveProfile: options.preserveProfile ?? true,
      ...options,
    });
    return browser;
  } catch (err) {
    if (err instanceof PlatformError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Failed to connect browser over CDP.';
    throw new PlatformError({
      code: 'XACT_5030',
      type: ErrorTypes.INTERNAL,
      message: `[CDP ERROR] ${message}`,
      suggestedAction: SuggestedActions.RELOGIN,
      cause: err,
      details: { cdpUrl },
    });
  }
}
