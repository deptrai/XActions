import { PrismaStore } from './prisma-store.js';
export class StoreWithRedis extends PrismaStore {
  constructor(options?: unknown);
}
export const defaultStore: StoreWithRedis;
