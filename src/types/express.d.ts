/// <reference lib="dom" />

// Express minimal type declarations for the JSDoc migration.
// The project does not install @types/express, so we provide the shapes
// needed by api/middleware and api/routes without using `any`.

declare module 'express' {
  export interface Request {
    [key: string]: unknown;
    path: string;
    method: string;
    ip: string;
    body: Record<string, unknown>;
    params: Record<string, string>;
    query: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    cookies: Record<string, string>;
    user: Record<string, unknown> | null;
  }

  export interface Response {
    [key: string]: unknown;
    locals?: Record<string, unknown>;
    status(code: number): Response;
    json(body: unknown): Response;
    send(body: unknown): Response;
    set(field: string, value: string): Response;
    set(fields: Record<string, string>): Response;
  }

  export type NextFunction = (err?: unknown) => void;

  export type RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void | Promise<void>;

  export interface IRouter {
    get(path: string, ...handlers: RequestHandler[]): IRouter;
    post(path: string, ...handlers: RequestHandler[]): IRouter;
    put(path: string, ...handlers: RequestHandler[]): IRouter;
    patch(path: string, ...handlers: RequestHandler[]): IRouter;
    delete(path: string, ...handlers: RequestHandler[]): IRouter;
    use(...handlers: RequestHandler[]): IRouter;
  }

  export function Router(): IRouter;
}
