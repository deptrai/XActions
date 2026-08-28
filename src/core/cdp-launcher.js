// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';
import { globalProxyPool } from '../proxy/proxy-pool.js';

/**
 * Resolve a bare executable name against the process PATH.
 * Returns the absolute path when found, otherwise null.
 *
 * @param {string} name
 * @returns {string | null}
 */
function findExecutableInPath(name) {
  const pathEnv = process.env.PATH || process.env.Path;
  if (!pathEnv) return null;
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
        } catch {
          if (process.platform !== 'win32') continue;
        }
        return candidate;
      }
    } catch {}
  }
  return null;
}

/**
 * Validate and coerce a port value.
 *
 * @param {unknown} portValue
 * @param {string} [fieldName='port']
 * @returns {number}
 */
function resolvePort(portValue, fieldName = 'port') {
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `[CDP ERROR] ${fieldName} must be an integer between 1 and 65535`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  return port;
}

/**
 * Resolve Chrome executable path based on platform.
 *
 * @param {string} [platform=process.platform]
 * @param {string|null} [customPath=null]
 * @returns {string} Executable path or binary name
 */
export function getChromeExecutablePath(platform = process.platform, customPath = null) {
  if (customPath) {
    if (!fs.existsSync(customPath) || !fs.statSync(customPath).isFile()) {
      throw new PlatformError({
        code: 'XACT_5030',
        type: ErrorTypes.INTERNAL,
        message: `[CDP ERROR] Chrome not found at ${customPath}. Install Chrome or set --chrome-path.`,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      });
    }
    try {
      fs.accessSync(customPath, fs.constants.X_OK);
    } catch {
      if (process.platform !== 'win32') {
        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: `[CDP ERROR] Chrome binary at ${customPath} is not executable.`,
          suggestedAction: SuggestedActions.CONTACT_SUPPORT,
        });
      }
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

  // Linux: find the first available candidate in PATH.
  const linuxCandidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const cand of linuxCandidates) {
    const found = findExecutableInPath(cand);
    if (found) return found;
  }
  // Fallback to the first candidate name; spawn will emit a clear error if not installed.
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
  } catch (err) {
    throw new PlatformError({
      code: 'XACT_5030',
      type: ErrorTypes.INTERNAL,
      message: `[CDP ERROR] Cannot create user data dir ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      suggestedAction: SuggestedActions.CONTACT_SUPPORT,
    });
  }
  return dir;
}

/**
 * Build Chrome launch arguments.
 *
 * @param {Object} [options={}]
 * @param {number} [options.port=9222]
 * @param {string} [options.userDataDir]
 * @param {boolean} [options.headless=false]
 * @param {any} [options.proxy]
 * @param {string[]} [options.extraArgs]
 * @returns {string[]}
 */
export function buildChromeArgs(options = {}) {
  const port = resolvePort(options.port ?? 9222);
  const userDataDir = options.userDataDir || getDefaultUserDataDir();
  const headless = Boolean(options.headless);

  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
  ];

  if (headless) {
    args.push('--headless=new');
  }

  if (options.proxy) {
    // Delegate anti-leak proxy flag generation to the shared ProxyIpPool normalizer.
    const proxyArgs = globalProxyPool.getBrowserArgs(options.proxy);
    args.push(...proxyArgs);
  }

  if (Array.isArray(options.extraArgs)) {
    args.push(...options.extraArgs);
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
  const retries = Math.max(1, options.retries ?? 1);
  const delayMs = options.delayMs ?? 100;
  const rawUrl = String(cdpUrl).trim();
  const normalizedUrl = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : `http://${rawUrl.replace(/^\/+/, '')}`;

  let baseUrl;
  try {
    baseUrl = new URL(normalizedUrl).href.replace(/\/+$/, '');
  } catch (err) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `[CDP ERROR] Invalid CDP URL: ${cdpUrl}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      cause: err,
    });
  }
  const versionUrl = `${baseUrl}/json/version`;

  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (
          data &&
          typeof data.webSocketDebuggerUrl === 'string' &&
          data.webSocketDebuggerUrl.length > 0
        ) {
          return data.webSocketDebuggerUrl;
        }
        lastError = new Error('CDP endpoint returned OK but missing webSocketDebuggerUrl');
      } else {
        lastError = new Error(`CDP endpoint returned ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new PlatformError({
    code: 'XACT_5030',
    type: ErrorTypes.INTERNAL,
    message: `[CDP ERROR] Could not reach Chrome DevTools at ${versionUrl}. Ensure Chrome is launched with --remote-debugging-port.`,
    suggestedAction: SuggestedActions.CONTACT_SUPPORT,
    cause: lastError,
    details: { cdpUrl, versionUrl },
  });
}

/**
 * Launch Chrome with remote debugging enabled.
 *
 * @param {Object} [options={}]
 * @param {number} [options.port=9222]
 * @param {string} [options.userDataDir]
 * @param {string} [options.chromePath]
 * @param {boolean} [options.headless=false]
 * @param {any} [options.proxy]
 * @param {string[]} [options.extraArgs]
 * @returns {Promise<{ port: number, cdpUrl: string, userDataDir: string, alreadyRunning?: boolean, kill: () => Promise<void> }>}
 */
export async function launchChrome(options = {}) {
  const port = resolvePort(options.port ?? 9222);
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
        kill: () => Promise.resolve(),
      };
    }
  } catch {}

  const executablePath = getChromeExecutablePath(process.platform, options.chromePath || null);
  const args = buildChromeArgs({
    port,
    userDataDir,
    headless: options.headless,
    proxy: options.proxy,
    extraArgs: options.extraArgs,
  });

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
  });

  // Capture spawn errors immediately so we don't wait for a timeout with a
  // misleading message.
  let spawnError = null;
  /** @type {Promise<void>} */
  const spawnReady = new Promise((resolve, reject) => {
    const onError = (/** @type {any} */ err) => {
      spawnError = err;
      cleanupListeners();
      reject(err);
    };
    const onSpawn = () => {
      cleanupListeners();
      resolve();
    };
    const cleanupListeners = () => {
      child.off('error', onError);
      child.off('spawn', onSpawn);
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });

  try {
    await spawnReady;
  } catch (err) {
    throw new PlatformError({
      code: 'XACT_5030',
      type: ErrorTypes.INTERNAL,
      message: `[CDP ERROR] Failed to spawn Chrome: ${err instanceof Error ? err.message : String(err)}`,
      suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      cause: err,
    });
  }

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
    kill: async () => {
      if (child && !child.killed) {
        try {
          child.kill();
        } catch {}
      }
    },
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
