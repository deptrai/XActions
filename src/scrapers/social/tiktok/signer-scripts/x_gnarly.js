// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTok X-Gnarly / a_bogus signing stub.
 *
 * TikTok Web uses an obfuscated anti-bot runtime (webmssdk/secsdk) that computes
 * dynamic query signatures such as `X-Bogus`/`X-Gnarly` and the `msToken` session
 * token. These algorithms are environment-dependent, minified and intentionally
 * hard to reverse-engineer.
 *
 * This file is a runtime-evaluated stub. In a real browser worker page it loads
 * the captured TikTok Web anti-bot bundles, warms them up against a real
 * tiktok.com page, and exposes a single signing function that accepts a URL
 * (including query) and returns `{ a_bogus, msToken, gnarly }`.
 *
 * Until the live anti-bot runtime is fully captured/initialised, this stub
 * returns a deterministic placeholder that satisfies the `SignerWorkerPagePool`
 * type contract. Tests that hit the live TikTok API will fail (red-phase) until
 * a real signature is produced, which is the intended TDD behaviour.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

(function (global) {
  'use strict';

  // Absolute minimal signing contract. The worker page will evaluate this
  // function after loading the anti-bot bundle. The real implementation can be
  // swapped here once the bundle globals are identified (e.g. `window._byted_acrawler`).
  function signTikTokUrl(url, options) {
    const opts = options || {};
    const ts = Date.now();
    const nonce = Math.random().toString(36).slice(2, 10);

    // Red-phase stub: produces a non-empty, deterministically shaped token so
    // `TikTokClient.sign()` has a value to append, but real TikTok API will reject it.
    return {
      a_bogus: `DFsSwQVLQfAiv-${ts}-${nonce}`,
      X_Bogus: `DFsSwQVLQfAiv-${ts}-${nonce}`,
      msToken: opts.msToken || '',
      X_Gnarly: `MH${Math.random().toString(36).slice(2, 16)}${nonce}`,
      query: {
        a_bogus: `DFsSwQVLQfAiv-${ts}-${nonce}`,
        msToken: opts.msToken || '',
        'X-Bogus': `DFsSwQVLQfAiv-${ts}-${nonce}`,
        'X-Gnarly': `MH${Math.random().toString(36).slice(2, 16)}${nonce}`,
      },
    };
  }

  // Expose on the global object so the worker page can call it after script injection.
  if (global) {
    global.signTikTokUrl = signTikTokUrl;
  }

  // Default export for Node module eval (not used by worker page evaluate).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { signTikTokUrl };
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
