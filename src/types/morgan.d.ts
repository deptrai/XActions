declare module 'morgan' {
  import type { Request, RequestHandler, Response } from 'express';
  function morgan(format: string, options?: Record<string, unknown>): RequestHandler;
  namespace morgan {
    function token(name: string, fn: (req: Request, res: Response) => string | undefined | null): void;
  }
  export = morgan;
}
