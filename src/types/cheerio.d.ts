declare module 'cheerio' {
  export interface Cheerio {
    length: number;
    each(callback: (index: number, element: unknown) => void): unknown;
    html(): string;
    html(element: unknown): string;
    text(): string;
    attr(name: string): string | undefined;
  }

  export interface CheerioAPI {
    (selector: string): Cheerio;
    load(html: string | Buffer, options?: { xml?: boolean }): CheerioAPI;
    html(): string;
    html(element: unknown): string;
    text(): string;
  }

  export function load(html: string | Buffer, options?: { xml?: boolean }): CheerioAPI;

  const cheerio: { load: typeof load } & CheerioAPI;
  export default cheerio;
}
