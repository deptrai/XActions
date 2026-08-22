declare module 'express-rate-limit' {
  import type { RequestHandler } from 'express';
  function rateLimit(options?: Record<string, unknown>): RequestHandler;
  export = rateLimit;
}
