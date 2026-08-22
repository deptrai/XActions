declare module 'helmet' {
  import type { RequestHandler } from 'express';
  function helmet(options?: Record<string, unknown>): RequestHandler;
  export = helmet;
}
