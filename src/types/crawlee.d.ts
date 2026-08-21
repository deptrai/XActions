declare module 'crawlee' {
  export interface CrawleeCookie {
    name: string;
    value: string;
    domain: string;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
  }

  export interface CrawleePage {
    goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
    evaluate<T = unknown>(fn: ((...args: unknown[]) => T) | string, ...args: unknown[]): Promise<T>;
    $$eval<T = unknown>(selector: string, mapFn: (elements: unknown[]) => T): Promise<T>;
    $$(selector: string): Promise<unknown[]>;
    content(): Promise<string>;
    setCookie(...cookies: CrawleeCookie[]): Promise<void>;
    setViewport(viewport: { width: number; height: number }): Promise<void>;
    setUserAgent(userAgent: string): Promise<void>;
    waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
    screenshot(options?: { path?: string; fullPage?: boolean }): Promise<unknown>;
    close(): Promise<void>;
    context?(): { addCookies(cookies: CrawleeCookie[]): Promise<void> };
  }

  export interface CrawleeBrowserPool {
    newPage(): Promise<CrawleePage>;
    destroy(): Promise<void>;
  }

  export interface CrawleePlugin {
    // Opaque browser plugin instance
  }

  export class BrowserPool implements CrawleeBrowserPool {
    constructor(options: { browserPlugins: CrawleePlugin[]; maxOpenPagesPerBrowser?: number; retireBrowserAfterPageCount?: number });
    newPage(): Promise<CrawleePage>;
    destroy(): Promise<void>;
  }

  export class PuppeteerPlugin implements CrawleePlugin {
    constructor(browser: unknown, options: { launchOptions: { headless?: boolean; args?: string[] } });
  }

  export class PlaywrightPlugin implements CrawleePlugin {
    constructor(browser: unknown, options: { launchOptions: { headless?: boolean; args?: string[] } });
  }

  export class ProxyConfiguration {
    constructor(options: { proxyUrls: string[] });
  }

  export interface CrawlerOptions {
    requestHandler?: (...args: unknown[]) => unknown;
    startUrls?: string[];
    maxRequestsPerCrawl?: number;
    maxConcurrency?: number;
    proxyConfiguration?: ProxyConfiguration;
    launchContext?: { launchOptions: { headless?: boolean; args?: string[] } };
  }

  export class PuppeteerCrawler {
    constructor(options: CrawlerOptions);
    run(): Promise<unknown>;
  }

  export class PlaywrightCrawler {
    constructor(options: CrawlerOptions);
    run(): Promise<unknown>;
  }
}

declare module '@crawlee/browser-pool' {
  export * from 'crawlee';
}
