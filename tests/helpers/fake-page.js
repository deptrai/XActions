// tests/helpers/fake-page.js
// Comprehensive fake Puppeteer page object for mutation testing browser functions.
// NOT a mock — a real configurable state machine that simulates DOM/browser behavior.
// Each method records calls so tests can assert against them.

/**
 * Create a fake Puppeteer page with configurable DOM state.
 *
 * @param {Object} opts
 * @param {string} [opts.currentUrl='https://www.facebook.com/'] - page.url() return
 * @param {Object} [opts.dom={}] - selector → element spec map
 * @param {Object} [opts.cookies=[]] - cookie jar
 * @param {Object} [opts.evalResults={}] - fn.toString() hash → return value
 * @param {string} [opts.content='<html></html>'] - page.content() return
 * @param {Object} [opts.gotoResult={}] - page.goto() return
 * @returns {Object} Fake page with .calls for assertions
 */
export function makeFakePage(opts = {}) {
  const {
    currentUrl = 'https://www.facebook.com/',
    dom = {},
    cookies = [],
    evalResults = {},
    content = '<html><body></body></html>',
    gotoResult = { ok: true },
    viewport = { width: 1280, height: 720 },
  } = opts;

  const calls = {
    goto: [],
    evaluate: [],
    $: [],
    $$: [],
    $x: [],
    $$eval: [],
    click: [],
    waitForSelector: [],
    setCookie: [],
    reload: [],
    content: [],
    url: [],
    setUserAgent: [],
    setViewport: [],
    evaluateOnNewDocument: [],
    emulateTimezone: [],
    setGeolocation: [],
    overridePermissions: [],
    keyboard: { down: [], up: [], press: [], type: [] },
    mouse: { move: [], click: [], down: [], up: [], wheel: [] },
  };

  const cookieJar = [...cookies];

  // Helper: find element by selector in dom map
  function findElement(selector) {
    // Try exact match first
    if (dom[selector]) return makeElementHandle(dom[selector], calls);
    // Try prefix match (for comma-separated selector chains)
    for (const key of Object.keys(dom)) {
      if (selector.includes(key) || key.includes(selector)) {
        return makeElementHandle(dom[key], calls);
      }
    }
    return null;
  }

  const keyboard = {
    down: async (key) => { calls.keyboard.down.push(key); },
    up: async (key) => { calls.keyboard.up.push(key); },
    press: async (key) => { calls.keyboard.press.push(key); },
    type: async (text, typeOpts = {}) => { calls.keyboard.type.push({ text, opts: typeOpts }); },
  };

  // Mouse object — records all mouse actions for behavioral simulation tests (Story 6.9/6.12)
  const mouse = {
    move: async (mx, my, moveOpts = {}) => { calls.mouse.move.push({ x: mx, y: my, opts: moveOpts }); },
    click: async (cx, cy, clickOpts = {}) => { calls.mouse.click.push({ x: cx, y: cy, opts: clickOpts }); },
    down: async (downOpts = {}) => { calls.mouse.down.push(downOpts); },
    up: async (upOpts = {}) => { calls.mouse.up.push(upOpts); },
    wheel: async (wheelOpts = {}) => { calls.mouse.wheel.push(wheelOpts); },
  };

  const page = {
    calls,
    keyboard,
    mouse,

    url: () => { calls.url.push(true); return currentUrl; },

    content: async () => { calls.content.push(true); return content; },

    goto: async (url, gotoOpts = {}) => {
      calls.goto.push({ url, opts: gotoOpts });
      return gotoResult;
    },

    reload: async (reloadOpts = {}) => {
      calls.reload.push({ opts: reloadOpts });
      return { ok: true };
    },

    setCookie: async (...newCookies) => {
      calls.setCookie.push(newCookies);
      cookieJar.push(...newCookies);
    },

    cookies: () => cookieJar,

    setUserAgent: async (ua) => {
      calls.setUserAgent.push(ua);
    },

    setViewport: async (vp) => {
      calls.setViewport.push(vp);
    },

    viewportSize: () => ({ ...viewport }),

    evaluateOnNewDocument: async (fn, ...args) => {
      calls.evaluateOnNewDocument.push({ fn: fn.toString(), args });
    },

    emulateTimezone: async (tz) => {
      calls.emulateTimezone.push(tz);
    },

    setGeolocation: async (geo) => {
      calls.setGeolocation.push(geo);
    },

    browserContext: () => ({
      overridePermissions: async (origin, permissions) => {
        calls.overridePermissions.push({ origin, permissions });
      },
    }),

    $: async (selector) => {
      calls.$.push(selector);
      return findElement(selector);
    },

    $$: async (selector) => {
      calls.$$.push(selector);
      // Return array of elements matching selector
      const elements = [];
      for (const key of Object.keys(dom)) {
        if (key === selector || selector.includes(key)) {
          if (Array.isArray(dom[key])) {
            for (const spec of dom[key]) elements.push(makeElementHandle(spec, calls));
          } else {
            elements.push(makeElementHandle(dom[key], calls));
          }
        }
      }
      return elements;
    },

    $x: async (xpath) => {
      calls.$x.push(xpath);
      // Return elements from dom that match xpath (simplified)
      const elements = [];
      for (const key of Object.keys(dom)) {
        if (key.includes('xpath') || xpath.includes(key)) {
          elements.push(makeElementHandle(dom[key], calls));
        }
      }
      return elements;
    },

    $$eval: async (selector, fn, ...args) => {
      calls.$$eval.push({ selector, fn: fn.toString(), args });
      // Find elements and apply fn
      const elements = [];
      for (const key of Object.keys(dom)) {
        if (key === selector) {
          if (Array.isArray(dom[key])) {
            elements.push(...dom[key]);
          } else {
            elements.push(dom[key]);
          }
        }
      }
      // fn receives (elements, ...args) — call it with the raw specs
      if (typeof fn === 'function') {
        return fn(elements, ...args);
      }
      return undefined;
    },

    click: async (selector) => {
      calls.click.push(selector);
      // Simulate click — find element and mark as clicked
      const el = findElement(selector);
      if (el && typeof el.click === 'function') {
        await el.click();
      }
    },

    waitForSelector: async (selector, waitOpts = {}) => {
      calls.waitForSelector.push({ selector, opts: waitOpts });
      const el = findElement(selector);
      if (!el) throw new Error(`waitForSelector: timeout waiting for ${selector}`);
      return el;
    },

    evaluate: async (fn, ...args) => {
      calls.evaluate.push({ fn: fn.toString(), args });
      // Check if there's a pre-configured result for this function
      const fnStr = fn.toString();
      const fnHash = fnStr.slice(0, 100); // first 100 chars as key
      if (evalResults[fnHash] !== undefined) {
        const result = evalResults[fnHash];
        return typeof result === 'function' ? result(...args) : result;
      }
      // Check by function body signature
      for (const [key, val] of Object.entries(evalResults)) {
        if (fnStr.includes(key)) {
          return typeof val === 'function' ? val(...args) : val;
        }
      }
      // Default: try calling fn with args (works for simple DOM simulations)
      if (typeof fn === 'function') {
        try {
          return fn(...args);
        } catch {
          return null;
        }
      }
      return null;
    },
  };

  return page;
}

/**
 * Create a fake ElementHandle from a spec.
 * @param {Object} spec - { textContent, ariaLabel, click, type, getAttribute, boundingBox, ... }
 * @param {Object} [calls] - shared calls recorder (optional for standalone handles)
 */
export function makeElementHandle(spec, calls = { keyboard: { down: [], up: [], press: [], type: [] }, click: [], mouse: { move: [], click: [], down: [], up: [] } }) {
  const clicked = { count: 0 };
  const typed = [];

  const handle = {
    _spec: spec,
    _clicked: clicked,
    _typed: typed,

    click: async () => {
      clicked.count++;
      if (spec.onClick) spec.onClick();
    },

    type: async (text, typeOpts = {}) => {
      typed.push({ text, opts: typeOpts });
    },

    getAttribute: (attr) => spec[attr] ?? spec.attributes?.[attr] ?? null,

    textContent: spec.textContent ?? spec.text ?? '',

    evaluate: async (fn) => {
      if (typeof fn === 'function') return fn(handle);
      return null;
    },

    // boundingBox — for humanClick (Story 6.10). Defaults to a reasonable box.
    // Use 'in' check so spec.boundingBox = null is respected (null = not visible).
    boundingBox: async () => ('boundingBox' in spec ? spec.boundingBox : { x: 100, y: 200, width: 50, height: 30 }),
  };

  // Copy any extra properties from spec
  for (const [key, val] of Object.entries(spec)) {
    if (!(key in handle)) {
      handle[key] = val;
    }
  }

  return handle;
}

/**
 * Create a fake browser object (for createBrowser/createPage seams).
 */
export function makeFakeBrowser(opts = {}) {
  const pages = [];
  return {
    newPage: async () => {
      const page = makeFakePage(opts);
      pages.push(page);
      return page;
    },
    close: async () => {},
    pages,
  };
}

/**
 * Create a routed fetch — maps URL substrings to response objects.
 * @param {Array<[string, {status, body}]>} routes - [urlSubstring, response]
 */
export function makeRoutedFetch(routes) {
  return async (url, opts = {}) => {
    for (const [substr, response] of routes) {
      if (url.includes(substr)) {
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          html: response.body,
          text: async () => response.body,
          json: async () => {
            try { return JSON.parse(response.body); } catch { return null; }
          },
        };
      }
    }
    return {
      ok: false,
      status: 404,
      html: '',
      text: async () => '',
      json: async () => null,
    };
  };
}
