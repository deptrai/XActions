declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html: string,
      options?: {
        url?: string;
        contentType?: string;
        pretendToBeVisual?: boolean;
        resources?: 'usable' | string;
        runScripts?: 'dangerously' | 'outside-only' | false;
      }
    );
    window: Window & { document: Document; navigator: Navigator; scrollY: number; eval(script: string): unknown; close(): void; dispatchEvent(event: Event): void; Event: typeof Event };
    serialize(): string;
  }
}
