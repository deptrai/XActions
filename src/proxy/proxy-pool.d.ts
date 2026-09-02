export interface Proxy {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
}

export type ProxyInput = string | Proxy | Record<string, unknown>;

/** Dual-pool partition name (AD-20). */
export type PoolName = 'realtime' | 'bulk';

/** Dual-pool partition statistics (AD-20). */
export interface DualPoolStats {
  realtime: { total: number; healthy: number; quarantined: number };
  bulk: { total: number; healthy: number; quarantined: number };
  /** Cumulative count of proxies borrowed from Bulk to serve Realtime requests. */
  yieldedCount: number;
}

export class ProxyIpPool {
  constructor(options?: Record<string, unknown>);

  get healthyCount(): number;
  get totalCount(): number;
  get antiLeakFlags(): string[];

  add(proxy: ProxyInput): void;
  getNext(requiresResidential?: boolean): Proxy | null;
  getRoundRobinProxy(requiresResidential?: boolean): Proxy | null;
  getRotatingProxy(requiresResidential?: boolean): Proxy | null;
  getStickyProxy(accountId: string, requiresResidential?: boolean, options?: { pool?: PoolName }): Proxy | null;
  quarantine(proxy: ProxyInput, durationMs?: number): void;
  isAllQuarantined(): boolean;
  pruneExpiredQuarantines(): void;

  getProxy(options?: Record<string, unknown>): Proxy | null;
  getRealtimeProxy(options?: Record<string, unknown>): Proxy | null;
  getBulkProxy(options?: Record<string, unknown>): Proxy | null;
  // Note: implementation returns a normalized proxy object; `Proxy` here is a
  // stand-in type for the public module interface. Prefer `types/proxy.d.ts` for
  // external consumers.
  getPoolStats(): DualPoolStats;
  getProxyAgent(proxy: Proxy, options?: Record<string, unknown>): unknown;
  release(proxy: ProxyInput): boolean;
  listAll(): Array<{ server: string; protocol: string; isQuarantined: boolean; quarantinedUntil: number | null; healthy: boolean; failCount: number }>;
  listProxies(): Array<{ key: string; server: string; protocol: string; host: string; port: number; residential: boolean; status: 'healthy' | 'quarantined'; quarantinedUntil: number | null; expiresAt: number | null; pool: PoolName }>;
  toPlaywrightProxy(proxy: ProxyInput): (Proxy & { bypass?: string }) | null;
  getBrowserArgs(proxy: ProxyInput): string[];
}

export const globalProxyPool: ProxyIpPool;

declare const _default: ProxyIpPool;
export default _default;
