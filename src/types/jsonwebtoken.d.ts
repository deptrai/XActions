/// <reference lib="dom" />

declare module 'jsonwebtoken' {
  export interface JwtPayload extends Record<string, unknown> {
    sub?: string;
    userId?: string;
    id?: string;
  }

  export function sign(
    payload: Record<string, unknown>,
    secret: string,
    options?: Record<string, unknown>
  ): string;

  export function verify(
    token: string,
    secret: string,
    options?: Record<string, unknown>
  ): JwtPayload;

  export function decode(token: string): JwtPayload | null;
}
