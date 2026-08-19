// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript Type Declarations for ProxyIpPool and Proxy Providers
 * @author nich (@nichxbt)
 * @license MIT
 */

import type { ProxyAgent, Socks5ProxyAgent } from 'undici';

export interface NormalizedProxy {
  scheme: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  server: string;
}

export interface PlaywrightProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface ProxyIpPoolOptions {
  proxies?: Array<string | Partial<NormalizedProxy>>;
  validateOnAdd?: boolean;
}

export interface ProxyAgentOptions {
  client?: 'undici' | 'got';
}

export interface AccountRecord {
  platform: string;
  accountId: string;
  credentials?: Record<string, unknown> | null;
  assignedProxy?: NormalizedProxy | null;
  hibernatingUntil?: number | null;
  velocity?: number;
}

export interface AccountPoolOptions {
  governor?: unknown;
}

export interface RegisterAccountsOptions {
  credentials?: Record<string, unknown>;
}

export declare class ProxyIpPool {
  validateOnAdd: boolean;

  constructor(options?: ProxyIpPoolOptions);

  get healthyCount(): number;
  get totalCount(): number;
  get antiLeakFlags(): string[];

  add(proxy: string | Partial<NormalizedProxy>): void;
  getNext(): NormalizedProxy | null;
  getStickyProxy(accountId: string): NormalizedProxy | null;
  quarantine(proxy: string | Partial<NormalizedProxy>, durationMs?: number): void;
  isAllQuarantined(): boolean;
  pruneExpiredQuarantines(): void;
  getBrowserArgs(proxy?: string | Partial<NormalizedProxy> | null): string[];
  toPlaywrightProxy(proxy: string | NormalizedProxy): PlaywrightProxyConfig | null;
  static toPlaywrightProxy(proxy: string | NormalizedProxy): PlaywrightProxyConfig | null;
  getProxyAgent(proxy: string | NormalizedProxy, options?: ProxyAgentOptions): ProxyAgent | Socks5ProxyAgent | string;
  static getProxyAgent(proxy: string | NormalizedProxy, options?: ProxyAgentOptions): ProxyAgent | Socks5ProxyAgent | string;
}

export declare const globalProxyPool: ProxyIpPool;

export declare class AccountPool {
  constructor(deps?: AccountPoolOptions);
  registerAccounts(platform: string, accountIds: string[], options?: RegisterAccountsOptions): void;
  getNextAvailable(platform: string): string | null;
  markUnavailable(accountId: string, reason?: string, durationMs?: number, platform?: string): void;
  markAvailable(accountId: string, platform?: string): void;
  getAccountVelocity(accountId: string, platform?: string): number;
  recordRequest(accountId: string, platform?: string): void;
  setAssignedProxy(accountId: string, proxy: NormalizedProxy | string | Partial<NormalizedProxy>, platform?: string): void;
  hasAvailable(platform: string): boolean;
  listPlatforms(): string[];
  listAccounts(platform: string): string[];
  getAccount(accountId: string, platform?: string): AccountRecord | null;
}

export declare const globalAccountPool: AccountPool;

export declare function parseProxyUrl(urlString: string): NormalizedProxy;
export declare function normalizeProxy(input: string | Partial<NormalizedProxy>): NormalizedProxy;
export declare function formatProxyUrl(proxy: string | Partial<NormalizedProxy>): string;
export declare function getProxyAgent(proxy: string | Partial<NormalizedProxy>, options?: ProxyAgentOptions): ProxyAgent | Socks5ProxyAgent | string;
