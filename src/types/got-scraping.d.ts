declare module 'got-scraping' {
  export interface GotScrapingOptions {
    url?: string;
    proxyUrl?: string;
    headerGeneratorOptions?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeout?: { request?: number };
    followRedirect?: boolean;
    responseType?: 'json' | 'text' | 'buffer';
    [key: string]: unknown;
  }

  export interface GotScrapingResponse {
    body: unknown;
    statusCode: number;
    headers: Record<string, string | string[]>;
  }

  export interface GotScrapingClient {
    (options: GotScrapingOptions): Promise<GotScrapingResponse>;
    (url: string, options?: GotScrapingOptions): Promise<GotScrapingResponse>;
    extend(options: GotScrapingOptions): GotScrapingClient;
    defaults: unknown;
    stream: unknown;
    paginate: unknown;
  }

  const gotScraping: GotScrapingClient;
  export { gotScraping };
  export default gotScraping;
}
