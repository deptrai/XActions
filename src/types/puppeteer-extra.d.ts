/// <reference lib="dom" />

declare module 'puppeteer-extra' {
  import type { PuppeteerNode } from 'puppeteer';

  export interface PuppeteerExtra extends PuppeteerNode {
    use(plugin: unknown): this;
  }

  const defaultExport: PuppeteerExtra;
  export default defaultExport;
}

declare module 'puppeteer-extra-plugin-stealth' {
  const StealthPlugin: () => unknown;
  export default StealthPlugin;
}
