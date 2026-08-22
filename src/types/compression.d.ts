declare module 'compression' {
  import type { Request, RequestHandler, Response } from 'express';
  interface CompressionOptions {
    level?: number;
    threshold?: number;
    filter?: (req: Request, res: Response) => boolean;
    [key: string]: unknown;
  }
  function compression(options?: CompressionOptions): RequestHandler;
  namespace compression {
    function filter(req: Request, res: Response): boolean;
  }
  export = compression;
}
