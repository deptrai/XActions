export interface Proxy {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
}

export type ProxyInput = string | Proxy | Record<string, unknown>;

export class ProxyIpPool {
  constructor(options?: Record<string, unknown>);

  get healthyCount(): number;
  get totalCount(): number;
  get antiLeakFlags(): string[];

  add(proxy: ProxyInput): void;
  getNext(requiresResidential?: boolean): Proxy | null;
  getRoundRobinProxy(requiresResidential?: boolean): Proxy | null;
  getRotatingProxy(requiresResidential?: boolean): Proxy | null;
  getStickyProxy(accountId: string, requiresResidential?: boolean): Proxy | null;
  quarantine(proxy: ProxyInput, durationMs?: number): void;
  isAllQuarantined(): boolean;
  pruneExpiredQuarantines(): void;

  getProxy(options?: Record<string, unknown>): Proxy | null;
  getProxyAgent(proxy: Proxy, options?: Record<string, unknown>): unknown;
  release(proxy: ProxyInput): boolean;
  listAll(): Array<{ server: string; protocol: string; isQuarantined: boolean; quarantinedUntil: number | null; healthy: boolean; failCount: number }>;
  toPlaywrightProxy(proxy: ProxyInput): (Proxy & { bypass?: string }) | null;
  getBrowserArgs(proxy: ProxyInput): string[];
}

export const globalProxyPool: ProxyIpPool;

declare const _default: ProxyIpPool;
export default _default;
