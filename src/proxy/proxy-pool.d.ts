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
  getNext(): Proxy | null;
  getRoundRobinProxy(): Proxy | null;
  getRotatingProxy(): Proxy | null;
  getStickyProxy(accountId: string): Proxy | null;
  quarantine(proxy: ProxyInput, durationMs?: number): void;
  isAllQuarantined(): boolean;
  pruneExpiredQuarantines(): void;

  getProxy(): Proxy | null;
  getProxyAgent(proxy: Proxy, options?: Record<string, unknown>): unknown;
  release(proxy: Proxy): void;
  toPlaywrightProxy(): Proxy & { bypass?: string };
}

export const globalProxyPool: ProxyIpPool;

declare const _default: ProxyIpPool;
export default _default;
