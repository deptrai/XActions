export interface HypeEngine {
  computeHypeMetrics(tokenId?: string, opts?: { hours?: number }): Promise<{ tokens: Record<string, unknown>[]; degraded: boolean; warning?: string }>;
  getTokenMetrics(tokenId: string, opts?: { hours?: number }): Promise<Record<string, unknown>>;
  emitHypeAlerts(metrics: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;
  computeWithAlerts(tokenId?: string, opts?: { hours?: number }): Promise<{ tokens: Record<string, unknown>[]; degraded: boolean; alerts: Record<string, unknown>[]; warning?: string }>;
}

export function createHypeAuthenticity(...args: unknown[]): HypeEngine;
export function getDefaultHypeAuthenticity(...args: unknown[]): HypeEngine;
export const HYPE_ALERT_MONITOR_ID: string;
declare const _default: Record<string, unknown>;
export default _default;
