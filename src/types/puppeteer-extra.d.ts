/// <reference lib="dom" />

// Make this a module so `declare module` blocks are augmentations.
export {};

declare module 'puppeteer' {
  interface Browser {
    /** Adapter name when created via the adapter registry. */
    _adapter?: string;
    /** Native browser object from the underlying framework. */
    _native?: unknown;
  }

  interface Page {
    /** Adapter name when created via the adapter registry. */
    _adapter?: string;
    /** Native page object from the underlying framework. */
    _native?: unknown;
    /** Browser reference attached by the multi-platform scraper dispatcher. */
    __xactions_browser?: Browser;
  }
}

declare module 'puppeteer-extra' {
  import type { Browser, LaunchOptions, Page, PuppeteerNode } from 'puppeteer';

  export interface PuppeteerExtra extends PuppeteerNode {
    use(plugin: unknown): this;
  }

  const _default: PuppeteerExtra;
  export default _default;

  // The package's CJS build also exposes the default instance's methods
  // directly on the module, so `import * as puppeteer` / default import
  // can be used as `puppeteer.use()` and `puppeteer.launch()`.
  export function use(plugin: unknown): PuppeteerExtra;
  export function launch(options?: LaunchOptions): Promise<Browser>;
}

declare module 'puppeteer-extra-plugin-stealth' {
  const StealthPlugin: (opts?: { enabledEvasions?: Set<string> }) => import('puppeteer-extra-plugin').PuppeteerExtraPlugin;
  export = StealthPlugin;
}
