/// <reference lib="dom" />

export {};

declare module 'socket.io' {
  interface Socket {
    user?: Record<string, unknown>;
    role?: string;
    sessionId?: string;
  }

  interface Server {
    on(event: string, listener: (...args: unknown[]) => void): Server;
    to(room: string): Server;
    emit(event: string, ...args: unknown[]): Server;
  }
}
