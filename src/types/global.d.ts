/// <reference types="node" />

import type { Server as SocketIoServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import type { Browser } from 'puppeteer';

declare global {
  /** Socket.io server instance set by the API server at startup. */
  var io: SocketIoServer | undefined;

  /** Active browser instances that need cleanup on shutdown. */
  var activeBrowsers: Set<Browser> | undefined;

  /** Shared Prisma client instance set by the API server. */
  var prismaClient: PrismaClient | undefined;
}

export {};
