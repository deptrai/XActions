/// <reference lib="dom" />

import type { PuppeteerNode } from 'puppeteer';

declare module 'puppeteer-extra' {
  interface PuppeteerExtra extends PuppeteerNode {
    use(plugin: unknown): this;
  }

  const puppeteerExtra: PuppeteerExtra;
  export default puppeteerExtra;
}

declare module 'puppeteer-extra-plugin-stealth' {
  const StealthPlugin: () => unknown;
  export default StealthPlugin;
}
