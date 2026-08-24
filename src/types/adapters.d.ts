interface AdapterBrowser {
  _native: unknown;
  _adapter: string;
  newPage?: (...args: unknown[]) => unknown;
  close?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

interface AdapterPage {
  _native: unknown;
  _adapter: string;
  goto?: (...args: unknown[]) => unknown;
  evaluate?: (...args: unknown[]) => unknown;
  querySelectorAll?: (...args: unknown[]) => unknown;
  setCookie?: (...args: unknown[]) => unknown;
  setViewport?: (...args: unknown[]) => unknown;
  setUserAgent?: (...args: unknown[]) => unknown;
  scroll?: (...args: unknown[]) => unknown;
  close?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

interface LaunchOptions {
  headless?: boolean | 'shell' | 'new';
  args?: string[];
  proxy?: { server?: string; username?: string; password?: string } | string;
  browser?: string;
  browserType?: string;
  browserPlugin?: 'puppeteer' | 'playwright';
  seleniumServer?: string;
  maxPagesPerBrowser?: number;
  retireAfter?: number;
  fingerprint?: 'chrome' | 'firefox' | 'safari';
  headerGeneratorOptions?: Record<string, unknown>;
  runScripts?: 'dangerously' | 'outside-only' | false;
  cookies?: string;
  headers?: Record<string, string>;
  rateLimitStrategy?: 'wait' | 'error';
  proxyUrl?: string;
  proxyUrls?: string[];
  maxConcurrency?: number;
  maxRequestsPerCrawl?: number;
  userAgent?: string;
  timeout?: number;
  preserveProfile?: boolean;
}

interface NewPageOptions {
  userAgent?: string;
  viewport?: { width: number; height: number };
  preserveProfile?: boolean;
}

interface GotoOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'networkidle0' | 'networkidle2';
  timeout?: number;
}

interface ScrollOptions {
  x?: number;
  y?: number;
}

interface ScreenshotOptions {
  path?: string;
  fullPage?: boolean;
}

interface WaitForSelectorOptions {
  timeout?: number;
}

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

interface CreateCrawlerOptions {
  requestHandler?: (...args: unknown[]) => unknown;
  startUrls?: string[];
  maxRequestsPerCrawl?: number;
  maxConcurrency?: number;
  proxyUrls?: string[];
  headless?: boolean;
}

interface HttpClient {
  setCookies(cookie: string): unknown;
  [key: string]: unknown;
}

interface HttpScraper {
  client: HttpClient;
  [key: string]: unknown;
}
