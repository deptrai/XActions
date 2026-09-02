// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
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
 * Validate that a file path points to an executable file.
 * Throws PlatformError if not.
 *
 * @param {string} executablePath
 * @param {string} [label='Browser']
 */
function validateExecutable(executablePath, label = 'Browser') {
  let stats;
  try {
    stats = fs.statSync(executablePath);
  } catch {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `[CDP ERROR] ${label} not found at ${executablePath}. Verify the path or install the browser.`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  if (!stats.isFile()) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `[CDP ERROR] ${label} path at ${executablePath} is not a file.`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  try {
    fs.accessSync(executablePath, fs.constants.X_OK);
  } catch {
    if (process.platform !== 'win32') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: `[CDP ERROR] ${label} binary at ${executablePath} is not executable.`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
  }
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
 * Resolve a browser executable path based on platform and optional browser name.
 * Supports Google Chrome, Microsoft Edge, Brave, Chromium, and Canary variants.
 *
 * @param {Object} [options={}]
 * @param {string} [options.platform=process.platform]
 * @param {string|null} [options.customPath=null]
 * @param {'chrome'|'edge'|'brave'|'chromium'|'canary'|'auto'} [options.browser='auto']
 * @returns {string} Absolute executable path
 */
export function resolveBrowserExecutablePath(options = {}) {
  const platform = options.platform ?? process.platform;
  const customPath = options.customPath ?? null;
  const browser = options.browser ?? 'auto';

  if (customPath) {
    validateExecutable(customPath, 'Custom browser');
    return customPath;
  }

  /** @type {Array<{name: string, path: string}>} */
  const candidates = [];

  if (platform === 'darwin') {
    const darwinApps = [
      { name: 'chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { name: 'brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      { name: 'canary', path: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' },
    ];
    candidates.push(...darwinApps);
  } else if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';

    const winPaths = [
      { name: 'chrome', path: path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'chrome', path: path.win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'chrome', path: path.win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'edge', path: path.win32.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'edge', path: path.win32.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'brave', path: path.win32.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      { name: 'canary', path: path.win32.join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe') },
    ];
    candidates.push(...winPaths);
  } else {
    // Linux / other POSIX
    const linuxBins = [
      { name: 'chrome', path: 'google-chrome' },
      { name: 'chrome', path: 'google-chrome-stable' },
      { name: 'edge', path: 'microsoft-edge-stable' },
      { name: 'edge', path: 'microsoft-edge' },
      { name: 'brave', path: 'brave' },
      { name: 'brave', path: 'brave-browser' },
      { name: 'chromium', path: 'chromium' },
      { name: 'chromium', path: 'chromium-browser' },
      { name: 'chromium', path: '/snap/bin/chromium' },
    ];
    for (const bin of linuxBins) {
      const resolved = findExecutableInPath(bin.path) || (fs.existsSync(bin.path) ? bin.path : null);
      if (resolved) {
        candidates.push({ name: bin.name, path: resolved });
      }
    }
  }

  const requested = browser === 'auto' ? null : browser;
  for (const cand of candidates) {
    if (requested && cand.name !== requested) continue;
    if (fs.existsSync(cand.path)) {
      try {
        fs.accessSync(cand.path, fs.constants.X_OK);
      } catch {
        if (platform !== 'win32') continue;
      }
      return cand.path;
    }
  }

  // Fallback: for auto, return the first candidate path even if missing so
  // spawn emits a clear error. For explicit browser, return the canonical
  // fallback path so tests without installed browsers can still assert shape.
  if (requested) {
    const requestedFallback = candidates.find((c) => c.name === requested);
    if (requestedFallback) {
      return requestedFallback.path;
    }

    // Requested browser has no candidate on this platform; return canonical name
    // so the caller can see what was requested instead of silently falling back.
    const canonicalFallback = getCanonicalFallback(platform, requested);
    if (canonicalFallback) return canonicalFallback;
  }

  const first = candidates.find((c) => fs.existsSync(c.path));
  if (first) return first.path;

  // No installed browser found; for auto, prefer a Chrome-family fallback if one
  // of those candidates exists at all (even if not on disk), otherwise fall back
  // to the first available candidate name.
  const anyChrome = candidates.find((c) => c.name === 'chrome');
  if (anyChrome) return anyChrome.path;

  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  }
  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return 'google-chrome';
}

/**
 * Return the canonical fallback path/name for a requested browser on a platform.
 * Used when the browser is not installed so the error message is specific.
 *
 * @param {string} platform
 * @param {string} requested
 * @returns {string | null}
 */
function getCanonicalFallback(platform, requested) {
  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    switch (requested) {
      case 'chrome':
        return path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
      case 'edge':
        return path.win32.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
      case 'brave':
        return path.win32.join(
          process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local',
          'BraveSoftware',
          'Brave-Browser',
          'Application',
          'brave.exe'
        );
      case 'canary':
        return path.win32.join(
          process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local',
          'Google',
          'Chrome SxS',
          'Application',
          'chrome.exe'
        );
    }
  }
  if (platform === 'darwin') {
    switch (requested) {
      case 'chrome':
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      case 'edge':
        return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
      case 'brave':
        return '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
      case 'canary':
        return '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
    }
  }
  switch (requested) {
    case 'chrome': return 'google-chrome';
    case 'edge': return 'microsoft-edge';
    case 'brave': return 'brave';
    case 'canary': return 'google-chrome-unstable';
    case 'chromium': return 'chromium';
  }
  return null;
}

/**
 * Resolve Chrome executable path based on platform.
 *
 * @param {string} [platform=process.platform]
 * @param {string|null} [customPath=null]
 * @returns {string} Executable path or binary name
 */
export function getChromeExecutablePath(platform = process.platform, customPath = null) {
  // getChromeExecutablePath is the legacy/CDP-specific entry point. It should
  // behave like an auto browser search but prefer Chrome-family binaries. On
  // Linux, when google-chrome is missing but chromium is on PATH, accept
  // chromium so tests and headless environments still resolve a working binary.
  return resolveBrowserExecutablePath({ platform, customPath, browser: 'auto' });
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
 * Check if a local TCP port is available for binding.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find a free local port in the range [startPort, endPort] (inclusive).
 * Returns the first available port or null if none found.
 *
 * @param {number} [startPort=9222]
 * @param {number} [endPort=9322]
 * @returns {Promise<number | null>}
 */
export async function findFreePort(startPort = 9222, endPort = 9322) {
  const start = resolvePort(startPort, 'startPort');
  const end = resolvePort(endPort, 'endPort');
  if (start > end) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `[CDP ERROR] startPort (${start}) must be less than or equal to endPort (${end}).`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return null;
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
    '--exclude-switches=enable-automation',
    '--disable-infobars',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
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

/** @type {Set<import('node:child_process').ChildProcess>} */
const launchedChildren = new Set();

/**
 * Register a child process for cleanup on SIGINT/SIGTERM/exit.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function registerChildCleanup(child) {
  launchedChildren.add(child);
}

/**
 * Kill all launched child processes. Safe to call repeatedly.
 */
export function cleanupLaunchedChildren() {
  for (const child of launchedChildren) {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {}
    }
  }
  launchedChildren.clear();
}

if (typeof process !== 'undefined') {
  process.once('SIGINT', cleanupLaunchedChildren);
  process.once('SIGTERM', cleanupLaunchedChildren);
  process.once('exit', cleanupLaunchedChildren);
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
 * @param {boolean} [options.scanFreePort=false]
 * @returns {Promise<{ port: number, cdpUrl: string, userDataDir: string, alreadyRunning?: boolean, kill: () => Promise<void> }>}
 */
export async function launchChrome(options = {}) {
  let port = resolvePort(options.port ?? 9222);
  const userDataDir = options.userDataDir || getDefaultUserDataDir();

  // If the requested port is occupied and scanning is enabled, try 9222-9322.
  if (options.scanFreePort && !(await isPortAvailable(port))) {
    const freePort = await findFreePort(port, 9322);
    if (freePort === null) {
      throw new PlatformError({
        code: 'XACT_5030',
        type: ErrorTypes.INTERNAL,
        message: `[CDP ERROR] No free debugging port found in range ${port}-9322.`,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      });
    }
    port = freePort;
  }

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

  const executablePath = resolveBrowserExecutablePath({
    platform: process.platform,
    customPath: options.chromePath || null,
    browser: 'auto',
  });
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

  registerChildCleanup(child);

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
