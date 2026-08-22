/// <reference lib="dom" />

// Express minimal type declarations for the JSDoc migration.
// The project does not install @types/express, so we provide the shapes
// needed by api/middleware and api/routes without using `any`.

declare module 'express' {
  function express(): express.Application;

  namespace express {
    export interface Request {
      [key: string]: unknown;
      path: string;
      method: string;
      ip: string;
      hostname?: string;
      protocol?: string;
      originalUrl?: string;
      baseUrl?: string;
      secure?: boolean;
      body: Record<string, unknown>;
      params: Record<string, string>;
      query: Record<string, string>;
      headers: Record<string, string | string[] | undefined>;
      cookies: Record<string, string>;
      signedCookies?: Record<string, string>;
      file?: Record<string, unknown>;
      files?: Record<string, unknown> | unknown[];
      user: Record<string, unknown> | null;
      agent?: Record<string, unknown> | null;
      app?: { get(name: string): unknown; set(name: string, value: unknown): unknown };
      x402?: { verified?: boolean };
    }

    export interface Response {
      [key: string]: unknown;
      locals?: Record<string, unknown>;
      status(code: number): Response;
      json(body: unknown): Response;
      jsonp(body: unknown): Response;
      send(body: unknown): Response;
      sendStatus(code: number): Response;
      set(field: string, value: string | number | string[]): Response;
      set(fields: Record<string, string | number | string[]>): Response;
      setHeader(name: string, value: string | number | string[]): Response;
      type(type: string): Response;
      redirect(url: string, status?: number): Response;
      location(url: string): Response;
      end(): void;
      write(chunk: string | Buffer | Uint8Array, encoding?: string): void;
      cookie(name: string, value: string | object, options?: Record<string, unknown>): Response;
      clearCookie(name: string, options?: Record<string, unknown>): Response;
      download(path: string, filename?: string, fn?: NextFunction): void;
      sendFile(path: string, fn?: NextFunction): void;
      sendFile(path: string, options: Record<string, unknown>, fn?: NextFunction): void;
    }

    export type NextFunction = (err?: unknown) => void;

    export type RequestHandler = (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void | Response | Promise<void | Response>;

    export type ErrorRequestHandler = (
      err: unknown,
      req: Request,
      res: Response,
      next: NextFunction
    ) => void | Response | Promise<void | Response>;

    export interface IRouter {
      get(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      post(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      put(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      patch(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      delete(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      options(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      all(path: string, ...handlers: (RequestHandler | RequestHandler[])[]): IRouter;
      use(...handlers: (RequestHandler | IRouter)[]): IRouter;
      use(...handlers: (ErrorRequestHandler | IRouter)[]): IRouter;
      use(path: string, ...handlers: (RequestHandler | IRouter)[]): IRouter;
      use(path: string[], ...handlers: (RequestHandler | IRouter)[]): IRouter;
      use(path: string, ...handlers: (ErrorRequestHandler | IRouter)[]): IRouter;
      use(path: string[], ...handlers: (ErrorRequestHandler | IRouter)[]): IRouter;
    }

    export interface Application extends IRouter {
      (req: import('http').IncomingMessage, res: import('http').ServerResponse, next?: () => void): void;
      set(name: string, value: unknown): Application;
      enable(name: string): Application;
      disable(name: string): Application;
      enabled(name: string): boolean;
      disabled(name: string): boolean;
      listen(port: number, hostname?: string, callback?: () => void): import('http').Server;
      listen(port: number, callback?: () => void): import('http').Server;
    }

    export function Router(): IRouter;
    export function raw(options?: Record<string, unknown>): RequestHandler;
    export function json(options?: Record<string, unknown>): RequestHandler;
    export function urlencoded(options?: Record<string, unknown>): RequestHandler;
    export function static(root: string, options?: Record<string, unknown>): RequestHandler;
  }

  export = express;
}
