// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook session fingerprint module (Story 6.2 + 6.4 — ADR-013).
 *
 * Pure module — does NOT import puppeteer or any browser library.
 * Receives `page` as a parameter to `applyFingerprint` and `applyNavigatorOverrides`.
 * This makes it unit-testable without a real browser (NFR2: centralized config).
 *
 * Exports:
 *   - UA_POOL         : array of real Chrome User-Agent strings
 *   - VIEWPORT_LIST   : array of { width, height } desktop viewports
 *   - generateFingerprint() : returns one fingerprint object per session
 *   - applyFingerprint(page, fp) : applies UA + viewport to a Puppeteer page
 *   - applyNavigatorOverrides(page, fp) : overrides navigator props via evaluateOnNewDocument
 *
 * Scope:
 *   - Story 6.2: generateFingerprint + applyFingerprint (UA + viewport)
 *   - Story 6.3: UA_POOL expanded to 21, VIEWPORT_LIST to 6, platform-aware deviceScaleFactor
 *   - Story 6.4: applyNavigatorOverrides (webdriver, hardwareConcurrency, deviceMemory, platform)
 *   - Story 6.5 (future): WebRTC leak prevention — separate function, same fingerprint object
 *
 * NFR4: fingerprint seed/UA/viewport must NEVER be logged in errors or responses.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// ============================================================================
// UA Pool — 20+ real Chrome UAs (Story 6.3 — expanded from 5 to 21)
// Verified Aug 2026: Chrome stable channel 146-152 (146-147 still in use by
// users who lag behind auto-update; 148-152 are current stable).
// Format: Mozilla/5.0 (<platform>) AppleWebKit/537.36 (KHTML, like Gecko)
//         Chrome/<ver>.0.0.0 Safari/537.36
// Distribution: Windows 10/11 x64 (7), macOS Intel/ARM (7), Linux x86_64 (7)
// All 21 UAs are unique (7 Chrome versions × 3 platforms).
// ============================================================================

const UA_POOL = [
  // Windows 10 / 11 — x64 (7 UAs, Chrome 146-152)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  // macOS — Intel & ARM (7 UAs, Chrome 146-152; ARM Macs send same UA as Intel in Chrome)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  // Linux — x86_64 (7 UAs, Chrome 146-152)
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
];

// ============================================================================
// Viewport List — 6 realistic desktop viewports (Story 6.3 — added 2560x1440)
// ============================================================================

const VIEWPORT_LIST = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 2560, height: 1440 },
];

// ============================================================================
// Hardware config pools
// ============================================================================

const HARDWARE_CONCURRENCY_POOL = [4, 6, 8];
const DEVICE_MEMORY_POOL = [2, 4, 8];

// ============================================================================
// Helpers
// ============================================================================

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Derive navigator.platform from a User-Agent string.
 * @param {string} ua
 * @returns {string} 'Win32' | 'MacIntel' | 'Linux x86_64'
 */
function derivePlatform(ua) {
  if (ua.includes('Windows')) return 'Win32';
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'MacIntel';
  if (ua.includes('Linux')) return 'Linux x86_64';
  return 'Win32'; // safe default
}

/**
 * Derive deviceScaleFactor from navigator.platform (Story 6.3 — platform-aware).
 * macOS defaults to 2 (Retina); Windows/Linux default to 1 (standard DPI).
 * This ensures internal fingerprint consistency (FR2).
 * @param {string} platform - 'Win32' | 'MacIntel' | 'Linux x86_64'
 * @returns {number} 2 for macOS, 1 for Windows/Linux
 */
function deriveDeviceScaleFactor(platform) {
  if (platform === 'MacIntel') return 2;
  return 1; // Win32, Linux x86_64, and safe default
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a single fingerprint for one automation session.
 * The fingerprint MUST be reused for every page/tab in that session
 * (ADR-013: one fingerprint per session — do NOT randomize mid-session).
 *
 * @returns {{ ua: string, viewport: { width: number, height: number },
 *             deviceScaleFactor: number, hardwareConcurrency: number,
 *             deviceMemory: number, platform: string }}
 */
export function generateFingerprint() {
  const ua = pick(UA_POOL);
  const viewport = pick(VIEWPORT_LIST);
  const platform = derivePlatform(ua);
  const deviceScaleFactor = deriveDeviceScaleFactor(platform);
  const hardwareConcurrency = pick(HARDWARE_CONCURRENCY_POOL);
  const deviceMemory = pick(DEVICE_MEMORY_POOL);
  return { ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform };
}

/**
 * Apply UA + viewport to a Puppeteer page.
 * Scope: ONLY setUserAgent + setViewport. Navigator overrides (Story 6.4)
 * are handled by `applyNavigatorOverrides`. WebRTC prevention (Story 6.5)
 * will be handled by its own function.
 *
 * NFR4: error messages must NOT include fingerprint fields.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ ua: string, viewport: { width: number, height: number },
 *           deviceScaleFactor: number }} fingerprint
 * @returns {Promise<void>}
 */
export async function applyFingerprint(page, fingerprint) {
  try {
    await page.setUserAgent(fingerprint.ua);
    await page.setViewport({
      width: fingerprint.viewport.width,
      height: fingerprint.viewport.height,
      deviceScaleFactor: fingerprint.deviceScaleFactor,
    });
  } catch (err) {
    // NFR4: do not echo fingerprint fields in the error message.
    // Preserve original error via `cause` for debugging without leaking fingerprint data.
    throw new Error('❌ Failed to apply fingerprint', { cause: err });
  }
}

/**
 * Override navigator automation indicators via `page.evaluateOnNewDocument`.
 *
 * Uses `Object.defineProperty` with `get` accessors — modern Chrome (v90+)
 * silently ignores direct assignment to navigator properties.
 *
 * Overrides applied (Story 6.4 — ADR-013):
 *   - navigator.webdriver → undefined (defense-in-depth; stealth plugin also handles)
 *   - navigator.hardwareConcurrency → fingerprint.hardwareConcurrency (session-specific)
 *   - navigator.deviceMemory → fingerprint.deviceMemory (session-specific)
 *   - navigator.platform → fingerprint.platform (must match UA)
 *
 * The fingerprint object is passed as an argument to evaluateOnNewDocument
 * (serialized to page context) — NOT string interpolation (avoids injection).
 *
 * NFR4: error messages must NOT include fingerprint fields.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ hardwareConcurrency: number, deviceMemory: number, platform: string }} fingerprint
 * @returns {Promise<void>}
 */
export async function applyNavigatorOverrides(page, fingerprint) {
  try {
    await page.evaluateOnNewDocument((fp) => {
      // navigator.webdriver — defense-in-depth (stealth plugin also handles this).
      // Setting to undefined when already undefined is a no-op.
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
      // navigator.hardwareConcurrency — session-specific (stealth doesn't randomize).
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => fp.hardwareConcurrency,
        configurable: true,
      });
      // navigator.deviceMemory — session-specific (stealth doesn't randomize).
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => fp.deviceMemory,
        configurable: true,
      });
      // navigator.platform — must match UA (stealth doesn't sync with custom UA).
      Object.defineProperty(navigator, 'platform', {
        get: () => fp.platform,
        configurable: true,
      });
    }, fingerprint);
  } catch (err) {
    // NFR4: do not echo fingerprint fields in the error message.
    // Preserve original error via `cause` for debugging without leaking fingerprint data.
    throw new Error('❌ Failed to apply navigator overrides', { cause: err });
  }
}

export { UA_POOL, VIEWPORT_LIST };
