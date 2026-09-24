// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions typed API client — Story 46.3 (Epic 46).
 *
 * Thin fetch wrapper around the OpenAPI 3.1 spec. Generated method stubs are
 * emitted per-operationId; the core `request` method is hand-written and
 * stable across regenerations.
 *
 * ApiResult<T> union:
 *   success → { ok: true, status: number, data: T }
 *   failure 402 → { ok: false, status: 402, error: PaymentRequiredPayload }
 *   failure other → { ok: false, status: number, error: ApiErrorPayload }
 *
 * Helper: `isPaymentRequired(res)` narrows failure to PaymentRequiredPayload.
 *
 * @module @xactions/api-client
 */

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  type?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PaymentRequiredPayload {
  x402Version?: number;
  accepts?: Array<{
    scheme?: string;
    network?: string;
    maxAmountRequired?: string;
    resource?: string;
    payTo?: string;
  }>;
  [key: string]: unknown;
}

export type ApiSuccess<T> = { ok: true; status: number; data: T };
export type ApiPaymentRequired = { ok: false; status: 402; error: PaymentRequiredPayload };
export type ApiFailure = { ok: false; status: number; error: ApiErrorPayload };

export type ApiResult<T> = ApiSuccess<T> | ApiPaymentRequired | ApiFailure;

/** Type guard — narrows failure response to x402 PaymentRequired */
export function isPaymentRequired(res: ApiResult<unknown>): res is ApiPaymentRequired {
  return !res.ok && res.status === 402;
}

export interface XActionsClientOptions {
  /** Base URL — defaults to https://xactions.app (production) or http://localhost:3001 when NODE_ENV=development */
  baseUrl?: string;
  /** bearerAuth — JWT for user-facing routes */
  bearerToken?: string;
  /** sessionCookie — X/Twitter auth_token cookie for pilot mounts */
  sessionCookie?: string;
  /** x402Payment — signed USDC payment payload for /api/ai/* routes */
  x402Payment?: string;
  /** a2aApiKey — X-Agent-API-Key for A2A/admin routes */
  a2aApiKey?: string;
  /** apiKey — X-API-Key alternate A2A key */
  apiKey?: string;
  /** Custom fetch implementation (useful for testing or proxy agents) */
  fetch?: typeof fetch;
  /** Additional headers to merge into every request */
  extraHeaders?: Record<string, string>;
}

export class XActionsClient {
  baseUrl: string;
  bearerToken?: string;
  sessionCookie?: string;
  x402Payment?: string;
  a2aApiKey?: string;
  apiKey?: string;
  extraHeaders: Record<string, string>;
  private _fetch: typeof fetch;

  constructor(opts: XActionsClientOptions = {}) {
    const rawUrl =
      opts.baseUrl ??
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
        ? 'http://localhost:3001'
        : 'https://xactions.app');
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.bearerToken = opts.bearerToken;
    this.sessionCookie = opts.sessionCookie;
    this.x402Payment = opts.x402Payment;
    this.a2aApiKey = opts.a2aApiKey;
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
    this._fetch = opts.fetch ?? (typeof globalThis !== 'undefined' && globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetch);
  }

  /**
   * Core request method — returns ApiResult<T>, never throws on HTTP errors.
   */
  async request<T = unknown>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const initHeaders: Record<string, string> =
      init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init.headers as Record<string, string> | undefined) ?? {};
    const headers = { ...this.extraHeaders, ...initHeaders };

    const res = await this._fetch(url, { ...init, headers });
    const status = res.status;
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let body: unknown = undefined;
    if (text && ct.includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else if (text) {
      body = text;
    }

    if (status >= 200 && status < 300) {
      // Unbox canonical envelope {success:true, data:T} if present; handle nullish data cleanly
      const isEnvelope = typeof body === 'object' && body !== null && 'success' in body && 'data' in body;
      const data = isEnvelope ? (body as { data: T }).data : (body as T);
      return { ok: true, status, data };
    }

    // 402 → x402 PaymentRequired (NOT envelope)
    if (status === 402) {
      return { ok: false, status: 402, error: (body as PaymentRequiredPayload) ?? {} };
    }

    // Canonical envelope or raw error object
    const isObj = typeof body === 'object' && body !== null;
    const err = isObj && 'error' in (body as object) ? ((body as { error?: ApiErrorPayload }).error) : undefined;
    const errorPayload: ApiErrorPayload =
      err ??
      (isObj
        ? (body as ApiErrorPayload)
        : { code: 'INTERNAL', message: String(body ?? res.statusText) });

    return {
      ok: false,
      status,
      error: errorPayload,
    };
  }

  /** List available agent-to-agent protocol peers (GET /api/a2a/agents) */
  async getApiA2aAgents<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.a2aApiKey) headers['X-Agent-API-Key'] = this.a2aApiKey;
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/a2a/agents';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get global system and user statistics (GET /api/admin/stats) */
  async getApiAdminStats<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/admin/stats';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List registered outbound webhooks (GET /api/admin/webhooks) */
  async getApiAdminWebhooks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/admin/webhooks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Create a new outbound webhook (POST /api/admin/webhooks) */
  async postApiAdminWebhooks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/admin/webhooks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Start the autonomous thought leader growth agent (POST /api/agent/start) */
  async postApiAgentStart<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/agent/start';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Stop the running growth agent instance (POST /api/agent/stop) */
  async postApiAgentStop<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/agent/stop';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Appeal account suspension (POST /api/ai/account/appeal-suspension) */
  async postApiAiAccountAppealSuspension<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/appeal-suspension';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Audit followers for bots and fake accounts (POST /api/ai/account/audit-followers) */
  async postApiAiAccountAuditFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/audit-followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Full account backup (tweets, likes, bookmarks, followers) (POST /api/ai/account/backup) */
  async postApiAiAccountBackup<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/backup';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get connected third-party accounts (POST /api/ai/account/connected-accounts) */
  async postApiAiAccountConnectedAccounts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/connected-accounts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage delegate account access (POST /api/ai/account/delegate-access) */
  async postApiAiAccountDelegateAccess<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/delegate-access';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Request official Twitter data archive (POST /api/ai/account/download-data) */
  async postApiAiAccountDownloadData<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/download-data';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get account join date (POST /api/ai/account/join-date) */
  async postApiAiAccountJoinDate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/join-date';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get account login history (POST /api/ai/account/login-history) */
  async postApiAiAccountLoginHistory<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/login-history';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Multi-account management (POST /api/ai/account/multi-account) */
  async postApiAiAccountMultiAccount<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/multi-account';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate QR code for profile (POST /api/ai/account/qr-code) */
  async postApiAiAccountQrCode<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/qr-code';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Upload and sync contacts (POST /api/ai/account/upload-contacts) */
  async postApiAiAccountUploadContacts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/upload-contacts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Trigger identity verification flow (POST /api/ai/account/verify-identity) */
  async postApiAiAccountVerifyIdentity<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/account/verify-identity';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-comment on keyword tweets (POST /api/ai/action/auto-comment) */
  async postApiAiActionAutoComment<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/auto-comment';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-follow by keyword/hashtag (POST /api/ai/action/auto-follow) */
  async postApiAiActionAutoFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/auto-follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-like tweets by keyword (POST /api/ai/action/auto-like) */
  async postApiAiActionAutoLike<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/auto-like';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-retweet by keyword (POST /api/ai/action/auto-retweet) */
  async postApiAiActionAutoRetweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/auto-retweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Bulk execute multiple actions (POST /api/ai/action/bulk-execute) */
  async postApiAiActionBulkExecute<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/bulk-execute';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Cancel an operation (POST /api/ai/action/cancel/{operationId}) */
  async postApiAiActionCancelOperationid<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/cancel/{operationId}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Detect who unfollowed you (POST /api/ai/action/detect-unfollowers) */
  async postApiAiActionDetectUnfollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/detect-unfollowers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Follow a user (POST /api/ai/action/follow) */
  async postApiAiActionFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Follow users who engaged with a tweet (POST /api/ai/action/follow-engagers) */
  async postApiAiActionFollowEngagers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/follow-engagers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Operation history (GET /api/ai/action/history) */
  async getApiAiActionHistory<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/ai/action/history';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Follow users tweeting about a keyword (POST /api/ai/action/keyword-follow) */
  async postApiAiActionKeywordFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/keyword-follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Like a tweet (POST /api/ai/action/like) */
  async postApiAiActionLike<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/like';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post a tweet (POST /api/ai/action/post-tweet) */
  async postApiAiActionPostTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/post-tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Quote-tweet (POST /api/ai/action/quote-tweet) */
  async postApiAiActionQuoteTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/quote-tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Retweet a tweet (POST /api/ai/action/retweet) */
  async postApiAiActionRetweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/retweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Smart unfollow inactive/non-followers (POST /api/ai/action/smart-unfollow) */
  async postApiAiActionSmartUnfollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/smart-unfollow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Check operation status (GET /api/ai/action/status/{operationId}) */
  async getApiAiActionStatusOperationid<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/ai/action/status/{operationId}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Unfollow a user (POST /api/ai/action/unfollow) */
  async postApiAiActionUnfollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/unfollow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unfollow all accounts (POST /api/ai/action/unfollow-everyone) */
  async postApiAiActionUnfollowEveryone<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/unfollow-everyone';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unfollow accounts that don't follow back (POST /api/ai/action/unfollow-non-followers) */
  async postApiAiActionUnfollowNonFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/unfollow-non-followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Validate a Twitter session cookie (POST /api/ai/action/validate-session) */
  async postApiAiActionValidateSession<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/action/validate-session';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get ad performance analytics (POST /api/ai/ads/analytics) */
  async postApiAiAdsAnalytics<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/ads/analytics';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Boost a tweet with ad spend (POST /api/ai/ads/boost) */
  async postApiAiAdsBoost<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/ads/boost';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage ad campaigns (POST /api/ai/ads/campaigns) */
  async postApiAiAdsCampaigns<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/ads/campaigns';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get ads dashboard and analytics (POST /api/ai/ads/dashboard) */
  async postApiAiAdsDashboard<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/ads/dashboard';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Access Media Studio for ads (POST /api/ai/ads/media-studio) */
  async postApiAiAdsMediaStudio<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/ads/media-studio';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get new follower alerts (POST /api/ai/alert/new-followers) */
  async postApiAiAlertNewFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/alert/new-followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Account analytics overview (POST /api/ai/analytics/account) */
  async postApiAiAnalyticsAccount<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/account';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze writing voice from tweets (POST /api/ai/analytics/analyze-voice) */
  async postApiAiAnalyticsAnalyzeVoice<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/analyze-voice';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Audience overlap between two accounts (POST /api/ai/analytics/audience-overlap) */
  async postApiAiAnalyticsAudienceOverlap<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/audience-overlap';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Best time to post analysis (POST /api/ai/analytics/best-time) */
  async postApiAiAnalyticsBestTime<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/best-time';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Brand mention monitoring (POST /api/ai/analytics/brand-monitor) */
  async postApiAiAnalyticsBrandMonitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/brand-monitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Compare multiple accounts (POST /api/ai/analytics/compare-accounts) */
  async postApiAiAnalyticsCompareAccounts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/compare-accounts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Competitor analysis (POST /api/ai/analytics/competitor) */
  async postApiAiAnalyticsCompetitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/competitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Creator monetization analytics (POST /api/ai/analytics/creator) */
  async postApiAiAnalyticsCreator<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/creator';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate tweet in user voice (POST /api/ai/analytics/generate-tweet) */
  async postApiAiAnalyticsGenerateTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/generate-tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Follower growth rate (POST /api/ai/analytics/growth-rate) */
  async postApiAiAnalyticsGrowthRate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/growth-rate';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analytics history over time (POST /api/ai/analytics/history) */
  async postApiAiAnalyticsHistory<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/history';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post/tweet performance analytics (POST /api/ai/analytics/post) */
  async postApiAiAnalyticsPost<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/post';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Rewrite a tweet for better engagement (POST /api/ai/analytics/rewrite-tweet) */
  async postApiAiAnalyticsRewriteTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/rewrite-tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Take analytics snapshot (POST /api/ai/analytics/snapshot) */
  async postApiAiAnalyticsSnapshot<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/snapshot';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Summarize a thread (POST /api/ai/analytics/summarize-thread) */
  async postApiAiAnalyticsSummarizeThread<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analytics/summarize-thread';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Deep profile analysis (POST /api/ai/analyze/profile) */
  async postApiAiAnalyzeProfile<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analyze/profile';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze a single tweet (POST /api/ai/analyze/tweet) */
  async postApiAiAnalyzeTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/analyze/tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get article performance analytics (POST /api/ai/articles/analytics) */
  async postApiAiArticlesAnalytics<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/articles/analytics';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Compose a longform article draft (POST /api/ai/articles/compose) */
  async postApiAiArticlesCompose<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/articles/compose';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Save article as draft (POST /api/ai/articles/draft) */
  async postApiAiArticlesDraft<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/articles/draft';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List published articles (POST /api/ai/articles/list) */
  async postApiAiArticlesList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/articles/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Publish an article on X (POST /api/ai/articles/publish) */
  async postApiAiArticlesPublish<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/articles/publish';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-reply to tweets matching keywords (POST /api/ai/automation/auto-reply) */
  async postApiAiAutomationAutoReply<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/auto-reply';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-repost tweets matching keywords (POST /api/ai/automation/auto-repost) */
  async postApiAiAutomationAutoRepost<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/auto-repost';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate automated content calendar (POST /api/ai/automation/content-calendar) */
  async postApiAiAutomationContentCalendar<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/content-calendar';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Repurpose top content into new formats (POST /api/ai/automation/content-repurpose) */
  async postApiAiAutomationContentRepurpose<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/content-repurpose';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Continuous follower monitoring (POST /api/ai/automation/continuous-monitor) */
  async postApiAiAutomationContinuousMonitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/continuous-monitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Customer service automation bot (POST /api/ai/automation/customer-service) */
  async postApiAiAutomationCustomerService<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/customer-service';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Systematic engagement booster (POST /api/ai/automation/engagement-booster) */
  async postApiAiAutomationEngagementBooster<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/engagement-booster';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Recycle evergreen tweets automatically (POST /api/ai/automation/evergreen) */
  async postApiAiAutomationEvergreen<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/evergreen';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor keyword mentions continuously (POST /api/ai/automation/keyword-monitor) */
  async postApiAiAutomationKeywordMonitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/keyword-monitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-plug replies on viral tweets (POST /api/ai/automation/plug-replies) */
  async postApiAiAutomationPlugReplies<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/plug-replies';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto quote-tweet matching posts (POST /api/ai/automation/quote-tweet-auto) */
  async postApiAiAutomationQuoteTweetAuto<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/quote-tweet-auto';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Welcome new followers via DM (POST /api/ai/automation/welcome-followers) */
  async postApiAiAutomationWelcomeFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/automation/welcome-followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create Stripe checkout session (POST /api/ai/billing/checkout) */
  async postApiAiBillingCheckout<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/billing/checkout';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List billing invoices (POST /api/ai/billing/invoices) */
  async postApiAiBillingInvoices<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/billing/invoices';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available subscription plans (POST /api/ai/billing/plans) */
  async postApiAiBillingPlans<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/billing/plans';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Open Stripe billing portal (POST /api/ai/billing/portal) */
  async postApiAiBillingPortal<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/billing/portal';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get current billing usage (POST /api/ai/billing/usage) */
  async postApiAiBillingUsage<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/billing/usage';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Clear all bookmarks (POST /api/ai/bookmarks/clear) */
  async postApiAiBookmarksClear<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/bookmarks/clear';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Export bookmarks to JSON or CSV (POST /api/ai/bookmarks/export) */
  async postApiAiBookmarksExport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/bookmarks/export';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get or create bookmark folders (POST /api/ai/bookmarks/folders) */
  async postApiAiBookmarksFolders<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/bookmarks/folders';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Import bookmarks from file (POST /api/ai/bookmarks/import) */
  async postApiAiBookmarksImport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/bookmarks/import';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Organize bookmarks into folders (POST /api/ai/bookmarks/organize) */
  async postApiAiBookmarksOrganize<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/bookmarks/organize';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Search within bookmarks (POST /api/ai/bookmarks/search) */
  async postApiAiBookmarksSearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/bookmarks/search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Archive tweets before deleting (POST /api/ai/cleanup/archive) */
  async postApiAiCleanupArchive<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/cleanup/archive';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Bulk delete tweets by IDs or filter (POST /api/ai/cleanup/bulk-delete) */
  async postApiAiCleanupBulkDelete<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/cleanup/bulk-delete';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Clear browsing/search history (POST /api/ai/cleanup/clear-history) */
  async postApiAiCleanupClearHistory<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/cleanup/clear-history';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Clear all retweets/reposts (POST /api/ai/cleanup/clear-reposts) */
  async postApiAiCleanupClearReposts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/cleanup/clear-reposts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Delete tweets matching criteria (POST /api/ai/cleanup/delete-tweets) */
  async postApiAiCleanupDeleteTweets<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/cleanup/delete-tweets';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unlike all liked tweets (POST /api/ai/cleanup/unlike-all) */
  async postApiAiCleanupUnlikeAll<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/cleanup/unlike-all';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create a new community (POST /api/ai/community/create) */
  async postApiAiCommunityCreate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/create';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Join communities by keyword (POST /api/ai/community/join) */
  async postApiAiCommunityJoin<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/join';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Leave a community (POST /api/ai/community/leave) */
  async postApiAiCommunityLeave<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/leave';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Leave all joined communities (POST /api/ai/community/leave-all) */
  async postApiAiCommunityLeaveAll<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/leave-all';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List joined communities (POST /api/ai/community/list) */
  async postApiAiCommunityList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage community members and settings (POST /api/ai/community/manage) */
  async postApiAiCommunityManage<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/manage';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get community members (POST /api/ai/community/members) */
  async postApiAiCommunityMembers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/members';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** View and contribute community notes (POST /api/ai/community/notes) */
  async postApiAiCommunityNotes<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/notes';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Search communities by keyword (POST /api/ai/community/search) */
  async postApiAiCommunitySearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/community/search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get creator monetization analytics (POST /api/ai/creator/analytics) */
  async postApiAiCreatorAnalytics<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/creator/analytics';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get creator revenue data (POST /api/ai/creator/revenue) */
  async postApiAiCreatorRevenue<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/creator/revenue';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Access Creator Studio dashboard (POST /api/ai/creator/studio) */
  async postApiAiCreatorStudio<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/creator/studio';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get creator subscriber list (POST /api/ai/creator/subscribers) */
  async postApiAiCreatorSubscribers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/creator/subscribers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage creator subscriptions (POST /api/ai/creator/subscriptions) */
  async postApiAiCreatorSubscriptions<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/creator/subscriptions';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Search CRM contacts (POST /api/ai/crm/search) */
  async postApiAiCrmSearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/crm/search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create CRM segment (POST /api/ai/crm/segment) */
  async postApiAiCrmSegment<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/crm/segment';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Sync followers to CRM (POST /api/ai/crm/sync) */
  async postApiAiCrmSync<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/crm/sync';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Tag a contact (POST /api/ai/crm/tag) */
  async postApiAiCrmTag<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/crm/tag';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Fetch a dataset (POST /api/ai/datasets/get) */
  async postApiAiDatasetsGet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/datasets/get';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available datasets (POST /api/ai/datasets/list) */
  async postApiAiDatasetsList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/datasets/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Browse the explore feed (POST /api/ai/discovery/explore) */
  async postApiAiDiscoveryExplore<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/explore';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get For You feed recommendations (POST /api/ai/discovery/for-you) */
  async postApiAiDiscoveryForYou<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/for-you';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Save a search query (POST /api/ai/discovery/save-search) */
  async postApiAiDiscoverySaveSearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/save-search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List saved searches (POST /api/ai/discovery/saved-searches) */
  async postApiAiDiscoverySavedSearches<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/saved-searches';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Search tweets, users, and media (POST /api/ai/discovery/search) */
  async postApiAiDiscoverySearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage followed topics (POST /api/ai/discovery/topics) */
  async postApiAiDiscoveryTopics<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/topics';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get trending topics (POST /api/ai/discovery/trending) */
  async postApiAiDiscoveryTrending<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/trending';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor trending topics over time (POST /api/ai/discovery/trending-monitor) */
  async postApiAiDiscoveryTrendingMonitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/discovery/trending-monitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Download video from a tweet (POST /api/ai/download/video) */
  async postApiAiDownloadVideo<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/download/video';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Audience demographics and insights (POST /api/ai/engagement/audience-insights) */
  async postApiAiEngagementAudienceInsights<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/audience-insights';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-follow by keyword or hashtag (POST /api/ai/engagement/auto-follow) */
  async postApiAiEngagementAutoFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/auto-follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-retweet by keywords (POST /api/ai/engagement/auto-retweet) */
  async postApiAiEngagementAutoRetweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/auto-retweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Bulk execute engagement actions (POST /api/ai/engagement/bulk-execute) */
  async postApiAiEngagementBulkExecute<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/bulk-execute';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Crypto tweet sentiment analysis (POST /api/ai/engagement/crypto-analyze) */
  async postApiAiEngagementCryptoAnalyze<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/crypto-analyze';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Detect bot accounts in followers (POST /api/ai/engagement/detect-bots) */
  async postApiAiEngagementDetectBots<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/detect-bots';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Full engagement report for a user (POST /api/ai/engagement/engagement-report) */
  async postApiAiEngagementEngagementReport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/engagement-report';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get explore/For You feed (POST /api/ai/engagement/explore) */
  async postApiAiEngagementExplore<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/explore';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Find niche influencers (POST /api/ai/engagement/find-influencers) */
  async postApiAiEngagementFindInfluencers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/find-influencers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Follow a user (POST /api/ai/engagement/follow) */
  async postApiAiEngagementFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Like a tweet (POST /api/ai/engagement/like) */
  async postApiAiEngagementLike<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/like';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Mute a user (POST /api/ai/engagement/mute) */
  async postApiAiEngagementMute<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/mute';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get notifications (POST /api/ai/engagement/notifications) */
  async postApiAiEngagementNotifications<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/notifications';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Quote-tweet (POST /api/ai/engagement/quote-tweet) */
  async postApiAiEngagementQuoteTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/quote-tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Retweet a tweet (POST /api/ai/engagement/retweet) */
  async postApiAiEngagementRetweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/retweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Smart targeting for growth (POST /api/ai/engagement/smart-target) */
  async postApiAiEngagementSmartTarget<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/smart-target';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Smart unfollow inactive users (POST /api/ai/engagement/smart-unfollow) */
  async postApiAiEngagementSmartUnfollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/smart-unfollow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get trending topics (POST /api/ai/engagement/trends) */
  async postApiAiEngagementTrends<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/trends';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unfollow a user (POST /api/ai/engagement/unfollow) */
  async postApiAiEngagementUnfollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/unfollow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unmute a user (POST /api/ai/engagement/unmute) */
  async postApiAiEngagementUnmute<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/engagement/unmute';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Export bookmarks (POST /api/ai/export/bookmarks) */
  async postApiAiExportBookmarks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/export/bookmarks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze social graph (POST /api/ai/graph/analyze) */
  async postApiAiGraphAnalyze<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/graph/analyze';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Build social graph (POST /api/ai/graph/build) */
  async postApiAiGraphBuild<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/graph/build';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List saved graphs (POST /api/ai/graph/list) */
  async postApiAiGraphList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/graph/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Graph-based account recommendations (POST /api/ai/graph/recommendations) */
  async postApiAiGraphRecommendations<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/graph/recommendations';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze image with Grok (POST /api/ai/grok/analyze-image) */
  async postApiAiGrokAnalyzeImage<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/grok/analyze-image';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Query Grok AI (POST /api/ai/grok/query) */
  async postApiAiGrokQuery<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/grok/query';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Summarize topic with Grok (POST /api/ai/grok/summarize) */
  async postApiAiGrokSummarize<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/grok/summarize';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Enrich lead profiles with additional data (POST /api/ai/leads/enrich) */
  async postApiAiLeadsEnrich<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/leads/enrich';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Export leads to CSV or JSON (POST /api/ai/leads/export) */
  async postApiAiLeadsExport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/leads/export';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Find B2B leads from X conversations (POST /api/ai/leads/find) */
  async postApiAiLeadsFind<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/leads/find';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor keyword conversations for leads (POST /api/ai/leads/monitor) */
  async postApiAiLeadsMonitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/leads/monitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Qualify leads with scoring criteria (POST /api/ai/leads/qualify) */
  async postApiAiLeadsQualify<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/leads/qualify';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Score and rank leads by quality (POST /api/ai/leads/score) */
  async postApiAiLeadsScore<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/leads/score';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get all lists (POST /api/ai/lists/all) */
  async postApiAiListsAll<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/lists/all';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get list members (POST /api/ai/lists/members) */
  async postApiAiListsMembers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/lists/members';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get media performance analytics (POST /api/ai/media/analytics) */
  async postApiAiMediaAnalytics<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/media/analytics';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Add captions to video media (POST /api/ai/media/captions) */
  async postApiAiMediaCaptions<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/media/captions';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Batch download media from multiple tweets (POST /api/ai/media/download-batch) */
  async postApiAiMediaDownloadBatch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/media/download-batch';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Browse media library (POST /api/ai/media/library) */
  async postApiAiMediaLibrary<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/media/library';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Access Media Studio dashboard (POST /api/ai/media/studio) */
  async postApiAiMediaStudio<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/media/studio';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Upload media to Twitter media library (POST /api/ai/media/upload) */
  async postApiAiMediaUpload<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/media/upload';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List DM conversations (POST /api/ai/messages/conversations) */
  async postApiAiMessagesConversations<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/messages/conversations';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Export DM history (POST /api/ai/messages/export) */
  async postApiAiMessagesExport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/messages/export';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Send a direct message (POST /api/ai/messages/send) */
  async postApiAiMessagesSend<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/messages/send';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Detect and block bot accounts (POST /api/ai/moderation/block-bots) */
  async postApiAiModerationBlockBots<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/block-bots';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get list of blocked accounts (POST /api/ai/moderation/blocked-list) */
  async postApiAiModerationBlockedList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/blocked-list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Block multiple accounts (POST /api/ai/moderation/mass-block) */
  async postApiAiModerationMassBlock<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/mass-block';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unblock multiple accounts (POST /api/ai/moderation/mass-unblock) */
  async postApiAiModerationMassUnblock<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/mass-unblock';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unmute multiple accounts (POST /api/ai/moderation/mass-unmute) */
  async postApiAiModerationMassUnmute<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/mass-unmute';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Mute users by keyword (POST /api/ai/moderation/mute-keywords) */
  async postApiAiModerationMuteKeywords<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/mute-keywords';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get list of muted accounts (POST /api/ai/moderation/muted-list) */
  async postApiAiModerationMutedList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/muted-list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage muted words list (POST /api/ai/moderation/muted-words) */
  async postApiAiModerationMutedWords<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/muted-words';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Soft-block to remove followers (POST /api/ai/moderation/remove-followers) */
  async postApiAiModerationRemoveFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/remove-followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Report spam accounts (POST /api/ai/moderation/report-spam) */
  async postApiAiModerationReportSpam<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/report-spam';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Check if account is shadowbanned (POST /api/ai/moderation/shadowban-check) */
  async postApiAiModerationShadowbanCheck<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/shadowban-check';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Toggle verified-only replies (POST /api/ai/moderation/verified-only) */
  async postApiAiModerationVerifiedOnly<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/moderation/verified-only';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor account changes (POST /api/ai/monitor/account) */
  async postApiAiMonitorAccount<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/account';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Compare follower snapshots (POST /api/ai/monitor/compare) */
  async postApiAiMonitorCompare<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/compare';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get follower change alerts (POST /api/ai/monitor/follower-alerts) */
  async postApiAiMonitorFollowerAlerts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/follower-alerts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor follower changes (POST /api/ai/monitor/followers) */
  async postApiAiMonitorFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor following changes (POST /api/ai/monitor/following) */
  async postApiAiMonitorFollowing<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/following';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor keyword mentions (POST /api/ai/monitor/keyword) */
  async postApiAiMonitorKeyword<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/keyword';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List monitored accounts (GET /api/ai/monitor/list) */
  async getApiAiMonitorList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/ai/monitor/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Delete a snapshot (DELETE /api/ai/monitor/snapshot/{username}) */
  async deleteApiAiMonitorSnapshotUsername<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'DELETE', headers };
    let url = this.baseUrl + '/api/ai/monitor/snapshot/{username}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get latest snapshot for a username (GET /api/ai/monitor/snapshot/{username}) */
  async getApiAiMonitorSnapshotUsername<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/ai/monitor/snapshot/{username}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Track tweet engagement over time (POST /api/ai/monitor/track-engagement) */
  async postApiAiMonitorTrackEngagement<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/monitor/track-engagement';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Send webhook notification (POST /api/ai/notify/send) */
  async postApiAiNotifySend<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/notify/send';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Test a webhook URL (POST /api/ai/notify/test) */
  async postApiAiNotifyTest<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/notify/test';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Suggest relevant hashtags (POST /api/ai/optimizer/hashtags) */
  async postApiAiOptimizerHashtags<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/optimizer/hashtags';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Optimize a tweet for engagement (POST /api/ai/optimizer/optimize) */
  async postApiAiOptimizerOptimize<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/optimizer/optimize';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Predict tweet performance (POST /api/ai/optimizer/predict) */
  async postApiAiOptimizerPredict<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/optimizer/predict';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate tweet variations (POST /api/ai/optimizer/variations) */
  async postApiAiOptimizerVariations<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/optimizer/variations';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create an automation persona (POST /api/ai/personas/create) */
  async postApiAiPersonasCreate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/create';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Delete a persona (POST /api/ai/personas/delete) */
  async postApiAiPersonasDelete<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/delete';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Edit a persona (POST /api/ai/personas/edit) */
  async postApiAiPersonasEdit<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/edit';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List personas (POST /api/ai/personas/list) */
  async postApiAiPersonasList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List persona presets (POST /api/ai/personas/presets) */
  async postApiAiPersonasPresets<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/presets';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Run a persona (POST /api/ai/personas/run) */
  async postApiAiPersonasRun<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/run';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get persona status (POST /api/ai/personas/status) */
  async postApiAiPersonasStatus<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/personas/status';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Convert data format (POST /api/ai/portability/convert) */
  async postApiAiPortabilityConvert<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/portability/convert';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Diff two account exports (POST /api/ai/portability/diff) */
  async postApiAiPortabilityDiff<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/portability/diff';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Export full account data (POST /api/ai/portability/export-account) */
  async postApiAiPortabilityExportAccount<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/portability/export-account';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Import data from another platform (POST /api/ai/portability/import) */
  async postApiAiPortabilityImport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/portability/import';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Migrate account to another platform (POST /api/ai/portability/migrate) */
  async postApiAiPortabilityMigrate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/portability/migrate';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List supported platforms for migration (POST /api/ai/portability/platforms) */
  async postApiAiPortabilityPlatforms<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/portability/platforms';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Publish an article (POST /api/ai/posting/article) */
  async postApiAiPostingArticle<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/article';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Bookmark a tweet (POST /api/ai/posting/bookmark) */
  async postApiAiPostingBookmark<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/bookmark';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get bookmarks (POST /api/ai/posting/bookmarks) */
  async postApiAiPostingBookmarks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/bookmarks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Clear all bookmarks (POST /api/ai/posting/clear-bookmarks) */
  async postApiAiPostingClearBookmarks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/clear-bookmarks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Delete a tweet (POST /api/ai/posting/delete) */
  async postApiAiPostingDelete<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/delete';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create a poll (POST /api/ai/posting/poll) */
  async postApiAiPostingPoll<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/poll';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Reply to a tweet (POST /api/ai/posting/reply) */
  async postApiAiPostingReply<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/reply';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Schedule a tweet (POST /api/ai/posting/schedule) */
  async postApiAiPostingSchedule<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/schedule';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post a thread (POST /api/ai/posting/thread) */
  async postApiAiPostingThread<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/thread';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post a tweet (POST /api/ai/posting/tweet) */
  async postApiAiPostingTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/posting/tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Check Premium subscription status (POST /api/ai/premium/check) */
  async postApiAiPremiumCheck<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/premium/check';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available Premium features (POST /api/ai/premium/features) */
  async postApiAiPremiumFeatures<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/premium/features';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Gift Premium subscription to a user (POST /api/ai/premium/gift) */
  async postApiAiPremiumGift<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/premium/gift';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage Premium subscription (POST /api/ai/premium/subscribe) */
  async postApiAiPremiumSubscribe<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/premium/subscribe';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get blocked accounts (POST /api/ai/profile/blocked) */
  async postApiAiProfileBlocked<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/profile/blocked';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Check Premium/Blue status (POST /api/ai/profile/check-premium) */
  async postApiAiProfileCheckPremium<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/profile/check-premium';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get account settings (POST /api/ai/profile/settings) */
  async postApiAiProfileSettings<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/profile/settings';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Toggle protected tweets (POST /api/ai/profile/toggle-protected) */
  async postApiAiProfileToggleProtected<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/profile/toggle-protected';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Update profile info (POST /api/ai/profile/update) */
  async postApiAiProfileUpdate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/profile/update';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Schedule a post (POST /api/ai/schedule/add) */
  async postApiAiScheduleAdd<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/add';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Find evergreen content to recycle (POST /api/ai/schedule/evergreen) */
  async postApiAiScheduleEvergreen<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/evergreen';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List scheduled posts (POST /api/ai/schedule/list) */
  async postApiAiScheduleList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Remove a scheduled post (POST /api/ai/schedule/remove) */
  async postApiAiScheduleRemove<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/remove';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Add RSS feed for auto-posting (POST /api/ai/schedule/rss-add) */
  async postApiAiScheduleRssAdd<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/rss-add';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Check RSS feed for new items (POST /api/ai/schedule/rss-check) */
  async postApiAiScheduleRssCheck<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/rss-check';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get RSS-generated drafts (POST /api/ai/schedule/rss-drafts) */
  async postApiAiScheduleRssDrafts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/schedule/rss-drafts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List followers (up to 1 000) (POST /api/ai/scrape/followers) */
  async postApiAiScrapeFollowers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/followers';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List following (up to 1 000) (POST /api/ai/scrape/following) */
  async postApiAiScrapeFollowing<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/following';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get tweets for a hashtag (POST /api/ai/scrape/hashtag) */
  async postApiAiScrapeHashtag<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/hashtag';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get tweet likers (POST /api/ai/scrape/likes) */
  async postApiAiScrapeLikes<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/likes';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get media from a profile (POST /api/ai/scrape/media) */
  async postApiAiScrapeMedia<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/media';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get @mentions of a user (POST /api/ai/scrape/mentions) */
  async postApiAiScrapeMentions<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/mentions';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get profile information (POST /api/ai/scrape/profile) */
  async postApiAiScrapeProfile<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/profile';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get quote tweets (POST /api/ai/scrape/quote-tweets) */
  async postApiAiScrapeQuoteTweets<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/quote-tweets';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get recommended accounts (POST /api/ai/scrape/recommendations) */
  async postApiAiScrapeRecommendations<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/recommendations';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get tweet replies (POST /api/ai/scrape/replies) */
  async postApiAiScrapeReplies<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/replies';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get tweet retweeters (POST /api/ai/scrape/retweets) */
  async postApiAiScrapeRetweets<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/retweets';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Search tweets (POST /api/ai/scrape/search) */
  async postApiAiScrapeSearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get thread / conversation (POST /api/ai/scrape/thread) */
  async postApiAiScrapeThread<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/thread';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get tweet history (POST /api/ai/scrape/tweets) */
  async postApiAiScrapeTweets<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/tweets';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get tweets a user liked (POST /api/ai/scrape/user-likes) */
  async postApiAiScrapeUserLikes<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/scrape/user-likes';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze tweet sentiment (POST /api/ai/sentiment/analyze) */
  async postApiAiSentimentAnalyze<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/sentiment/analyze';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Monitor brand reputation (POST /api/ai/sentiment/monitor) */
  async postApiAiSentimentMonitor<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/sentiment/monitor';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Reputation report (POST /api/ai/sentiment/report) */
  async postApiAiSentimentReport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/sentiment/report';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Access advanced settings (POST /api/ai/settings/advanced) */
  async postApiAiSettingsAdvanced<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/advanced';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Import or export block list (POST /api/ai/settings/block-list) */
  async postApiAiSettingsBlockList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/block-list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get blocked accounts list (POST /api/ai/settings/blocked) */
  async postApiAiSettingsBlocked<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/blocked';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Request Twitter data download (POST /api/ai/settings/download-data) */
  async postApiAiSettingsDownloadData<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/download-data';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get account settings (POST /api/ai/settings/get) */
  async postApiAiSettingsGet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/get';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get muted accounts list (POST /api/ai/settings/muted) */
  async postApiAiSettingsMuted<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/muted';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Toggle protected tweets mode (POST /api/ai/settings/protected) */
  async postApiAiSettingsProtected<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/protected';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Update account settings (POST /api/ai/settings/update) */
  async postApiAiSettingsUpdate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/settings/update';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Join a Space (POST /api/ai/spaces/join) */
  async postApiAiSpacesJoin<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/spaces/join';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Leave a Space (POST /api/ai/spaces/leave) */
  async postApiAiSpacesLeave<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/spaces/leave';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Discover live Spaces (POST /api/ai/spaces/list) */
  async postApiAiSpacesList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/spaces/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Scrape Space metadata (POST /api/ai/spaces/scrape) */
  async postApiAiSpacesScrape<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/spaces/scrape';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get Space status (POST /api/ai/spaces/status) */
  async postApiAiSpacesStatus<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/spaces/status';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get Space transcript (POST /api/ai/spaces/transcript) */
  async postApiAiSpacesTranscript<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/spaces/transcript';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Stream history (POST /api/ai/streams/history) */
  async postApiAiStreamsHistory<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/history';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List active streams (POST /api/ai/streams/list) */
  async postApiAiStreamsList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Pause a stream (POST /api/ai/streams/pause) */
  async postApiAiStreamsPause<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/pause';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Resume a paused stream (POST /api/ai/streams/resume) */
  async postApiAiStreamsResume<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/resume';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Start a keyword stream (POST /api/ai/streams/start) */
  async postApiAiStreamsStart<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/start';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get stream status (POST /api/ai/streams/status) */
  async postApiAiStreamsStatus<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/status';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Stop a stream (POST /api/ai/streams/stop) */
  async postApiAiStreamsStop<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/streams/stop';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create a team (POST /api/ai/teams/create) */
  async postApiAiTeamsCreate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/teams/create';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get team members (POST /api/ai/teams/members) */
  async postApiAiTeamsMembers<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/teams/members';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Collect and export timeline posts (POST /api/ai/timeline/collect) */
  async postApiAiTimelineCollect<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/timeline/collect';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Export collected timeline posts (POST /api/ai/timeline/export) */
  async postApiAiTimelineExport<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/timeline/export';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Auto-scroll timeline and collect posts (POST /api/ai/timeline/scroll) */
  async postApiAiTimelineScroll<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/timeline/scroll';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Switch between For You and Following feeds (POST /api/ai/timeline/switch-feed) */
  async postApiAiTimelineSwitchFeed<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/timeline/switch-feed';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** View current timeline feed (POST /api/ai/timeline/view) */
  async postApiAiTimelineView<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/timeline/view';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Discover topics by keyword (POST /api/ai/topics/discover) */
  async postApiAiTopicsDiscover<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/topics/discover';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Follow an X Topic (POST /api/ai/topics/follow) */
  async postApiAiTopicsFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/topics/follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List followed topics (POST /api/ai/topics/list) */
  async postApiAiTopicsList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/topics/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unfollow an X Topic (POST /api/ai/topics/unfollow) */
  async postApiAiTopicsUnfollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/topics/unfollow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unroll thread to plain text (POST /api/ai/unroll/thread) */
  async postApiAiUnrollThread<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/unroll/thread';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze why a tweet went viral (POST /api/ai/viral/analyze) */
  async postApiAiViralAnalyze<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/viral/analyze';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate high-engagement thread from trends (POST /api/ai/viral/generate) */
  async postApiAiViralGenerate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/viral/generate';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate viral headline variations (POST /api/ai/viral/headlines) */
  async postApiAiViralHeadlines<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/viral/headlines';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Research viral trends for content (POST /api/ai/viral/research) */
  async postApiAiViralResearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/viral/research';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get trending hook templates (POST /api/ai/viral/trending-hooks) */
  async postApiAiViralTrendingHooks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/viral/trending-hooks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Register a webhook endpoint (POST /api/ai/webhooks/create) */
  async postApiAiWebhooksCreate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/webhooks/create';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Delete a webhook (POST /api/ai/webhooks/delete) */
  async postApiAiWebhooksDelete<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/webhooks/delete';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available webhook event types (POST /api/ai/webhooks/events) */
  async postApiAiWebhooksEvents<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/webhooks/events';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List registered webhooks (POST /api/ai/webhooks/list) */
  async postApiAiWebhooksList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/webhooks/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Test a webhook with a sample payload (POST /api/ai/webhooks/test) */
  async postApiAiWebhooksTest<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/webhooks/test';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available workflow actions (POST /api/ai/workflows/actions) */
  async postApiAiWorkflowsActions<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/workflows/actions';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Create a workflow (POST /api/ai/workflows/create) */
  async postApiAiWorkflowsCreate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/workflows/create';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List saved workflows (POST /api/ai/workflows/list) */
  async postApiAiWorkflowsList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/workflows/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Run a workflow (POST /api/ai/workflows/run) */
  async postApiAiWorkflowsRun<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/workflows/run';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Analyze a user's writing voice from tweets (POST /api/ai/writer/analyze-voice) */
  async postApiAiWriterAnalyzeVoice<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/writer/analyze-voice';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate weekly content calendar (POST /api/ai/writer/calendar) */
  async postApiAiWriterCalendar<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/writer/calendar';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate tweets in a user's voice (POST /api/ai/writer/generate) */
  async postApiAiWriterGenerate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/writer/generate';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate a reply to a tweet (POST /api/ai/writer/reply) */
  async postApiAiWriterReply<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/writer/reply';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Rewrite / improve an existing tweet (POST /api/ai/writer/rewrite) */
  async postApiAiWriterRewrite<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/writer/rewrite';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List saved voice profiles (GET /api/ai/writer/voice-profiles) */
  async getApiAiWriterVoiceProfiles<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/ai/writer/voice-profiles';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get a voice profile (GET /api/ai/writer/voice-profiles/{username}) */
  async getApiAiWriterVoiceProfilesUsername<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/ai/writer/voice-profiles/{username}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Manage X Pro monitoring columns (POST /api/ai/xpro/columns) */
  async postApiAiXproColumns<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/xpro/columns';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Open X Pro (TweetDeck) dashboard (POST /api/ai/xpro/dashboard) */
  async postApiAiXproDashboard<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/xpro/dashboard';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Manage X Pro settings and layout (POST /api/ai/xpro/manage) */
  async postApiAiXproManage<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/ai/xpro/manage';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get account growth and engagement overview (GET /api/analytics/overview) */
  async getApiAnalyticsOverview<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/analytics/overview';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Log in with username or email (POST /api/auth/login) */
  async postApiAuthLogin<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/auth/login';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Refresh a JWT within 24h of expiry (POST /api/auth/refresh) */
  async postApiAuthRefresh<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/auth/refresh';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Register a new user (email optional) (POST /api/auth/register) */
  async postApiAuthRegister<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/auth/register';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get scraping benchmark latency and accuracy metrics (GET /api/benchmark/summary) */
  async getApiBenchmarkSummary<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/benchmark/summary';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get public pricing plans (GET /api/billing/plans) */
  async getApiBillingPlans<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/billing/plans';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List user bookmarks (GET /api/bookmarks) */
  async getApiBookmarks<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/bookmarks';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Bookmark a tweet (POST /api/bookmarks/add) */
  async postApiBookmarksAdd<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/bookmarks/add';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List checkpoints with filters and pagination (GET /api/checkpoints) */
  async getApiCheckpoints<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.a2aApiKey) headers['X-Agent-API-Key'] = this.a2aApiKey;
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/checkpoints';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get a single checkpoint by ID (GET /api/checkpoints/{id}) */
  async getApiCheckpointsId<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.a2aApiKey) headers['X-Agent-API-Key'] = this.a2aApiKey;
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/checkpoints/{id}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Pause a running/stalled checkpoint (POST /api/checkpoints/{id}/pause) */
  async postApiCheckpointsIdPause<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.a2aApiKey) headers['X-Agent-API-Key'] = this.a2aApiKey;
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/checkpoints/{id}/pause';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Resume a paused/failed/stalled checkpoint (POST /api/checkpoints/{id}/resume) */
  async postApiCheckpointsIdResume<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.a2aApiKey) headers['X-Agent-API-Key'] = this.a2aApiKey;
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/checkpoints/{id}/resume';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Retry a failed/stalled checkpoint (POST /api/checkpoints/{id}/retry) */
  async postApiCheckpointsIdRetry<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.a2aApiKey) headers['X-Agent-API-Key'] = this.a2aApiKey;
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/checkpoints/{id}/retry';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get creator monetization and analytics metrics (GET /api/creator/stats) */
  async getApiCreatorStats<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/creator/stats';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Auto-score all CRM contacts (POST /api/crm/score) */
  async postApiCrmScore<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/crm/score';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Search CRM contacts (GET /api/crm/search) */
  async getApiCrmSearch<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/crm/search';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List members of a CRM segment/tag (GET /api/crm/segment/{name}) */
  async getApiCrmSegmentName<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/crm/segment/{name}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Sync followers for a username into the CRM (POST /api/crm/sync/{username}) */
  async postApiCrmSyncUsername<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/crm/sync/{username}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Tag a CRM contact (POST /api/crm/tag) */
  async postApiCrmTag<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/crm/tag';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List downloadable scraped social intelligence datasets (GET /api/datasets) */
  async getApiDatasets<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/datasets';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get trending topics and hashtags (GET /api/discovery/trending) */
  async getApiDiscoveryTrending<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/discovery/trending';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Follow a user by handle (POST /api/engagement/follow) */
  async postApiEngagementFollow<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/engagement/follow';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Like a target tweet (POST /api/engagement/like) */
  async postApiEngagementLike<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/engagement/like';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Retweet a target tweet (POST /api/engagement/retweet) */
  async postApiEngagementRetweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/engagement/retweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available Facebook automation accounts (GET /api/facebook/accounts) */
  async getApiFacebookAccounts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/facebook/accounts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Register a new Facebook automation session cookie (POST /api/facebook/accounts) */
  async postApiFacebookAccounts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/facebook/accounts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post a comment on a Facebook post (POST /api/facebook/comment) */
  async postApiFacebookComment<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/facebook/comment';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Scrape a public Facebook profile or page (POST /api/facebook/scrape/profile) */
  async postApiFacebookScrapeProfile<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/facebook/scrape/profile';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get dynamic rate limiter and account governor metrics (GET /api/governor/status) */
  async getApiGovernorStatus<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/governor/status';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Compute network graph centrality metrics (GET /api/graph/centrality) */
  async getApiGraphCentrality<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/graph/centrality';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Verify an offline or enterprise license key (POST /api/license/verify) */
  async postApiLicenseVerify<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/license/verify';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Send a direct message to a user (POST /api/messages/send) */
  async postApiMessagesSend<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/messages/send';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List recent background automation operations (GET /api/operations) */
  async getApiOperations<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/operations';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get status and logs of a specific operation (GET /api/operations/{id}) */
  async getApiOperationsId<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/operations/{id}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Suggest hashtags for tweet text (POST /api/optimizer/hashtags) */
  async postApiOptimizerHashtags<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/optimizer/hashtags';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Optimize tweet text for a goal (POST /api/optimizer/optimize) */
  async postApiOptimizerOptimize<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/optimizer/optimize';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Predict tweet performance (POST /api/optimizer/predict) */
  async postApiOptimizerPredict<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/optimizer/predict';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Generate tweet variations (POST /api/optimizer/variations) */
  async postApiOptimizerVariations<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/optimizer/variations';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Cross-platform reverse identity and handle search (GET /api/osint/lookup) */
  async getApiOsintLookup<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/osint/lookup';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get unified social platform scraping and crawler health (GET /api/platform/status) */
  async getApiPlatformStatus<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/platform/status';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Post a tweet with an attached poll (POST /api/posting/poll) */
  async postApiPostingPoll<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/posting/poll';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post a multi-tweet thread (POST /api/posting/thread) */
  async postApiPostingThread<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/posting/thread';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Post a new tweet (POST /api/posting/tweet) */
  async postApiPostingTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/posting/tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get account profile information (GET /api/profile) */
  async getApiProfile<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/profile';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Update account profile metadata (POST /api/profile/update) */
  async postApiProfileUpdate<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/profile/update';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List available proxies in the dynamic pool (GET /api/proxies) */
  async getApiProxies<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/proxies';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Add a new proxy node to the rotation pool (POST /api/proxies) */
  async postApiProxies<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/proxies';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Schedule a tweet for future automated publishing (POST /api/schedule/tweet) */
  async postApiScheduleTweet<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/schedule/tweet';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Inspect registered runtime contract validation schemas (GET /api/schemas/registry) */
  async getApiSchemasRegistry<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/schemas/registry';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List all available browser scripts with prices (GET /api/scripts) */
  async getApiScripts<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/scripts';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Download an automation script (GET /api/scripts/automation/{name}) */
  async getApiScriptsAutomationName<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/scripts/automation/{name}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List available standalone browser automation scripts (GET /api/scripts/browser) */
  async getApiScriptsBrowser<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/scripts/browser';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Download a browser script from src/ (GET /api/scripts/src/{name}) */
  async getApiScriptsSrcName<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.x402Payment) headers['X-PAYMENT'] = this.x402Payment;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/scripts/src/{name}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get the current authentication method (GET /api/session/auth-method) */
  async getApiSessionAuthMethod<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/session/auth-method';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Remove the stored session cookie (switch back to OAuth) (DELETE /api/session/remove-session) */
  async deleteApiSessionRemoveSession<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'DELETE', headers };
    let url = this.baseUrl + '/api/session/remove-session';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Save a session cookie for browser automation (POST /api/session/save-session) */
  async postApiSessionSaveSession<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/session/save-session';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get user application settings (GET /api/settings) */
  async getApiSettings<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/settings';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Discover live Twitter Spaces (GET /api/spaces/active) */
  async getApiSpacesActive<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/spaces/active';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List user collaborative automation teams (GET /api/teams) */
  async getApiTeams<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/teams';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Create a new automation team (POST /api/teams) */
  async postApiTeams<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/teams';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Unroll and reconstruct a tweet thread (GET /api/thread/unroll/{tweetId}) */
  async getApiThreadUnrollTweetid<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/thread/unroll/{tweetId}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get current authenticated Twitter user details (GET /api/twitter/user) */
  async getApiTwitterUser<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/twitter/user';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Detect recent unfollowers (POST /api/unfollowers/detect) */
  async postApiUnfollowersDetect<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/unfollowers/detect';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** List detected unfollowers (GET /api/unfollowers/list) */
  async getApiUnfollowersList<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/unfollowers/list';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get current platform user record (GET /api/user/me) */
  async getApiUserMe<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/user/me';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Download high-resolution video stream (binary mp4 stream, envelope-exempt) (GET /api/video/download) */
  async getApiVideoDownload<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/video/download';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Run a prediction backtest for platform+niche (POST /api/viral/backtest) */
  async postApiViralBacktest<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/viral/backtest';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Get backtest report status (GET /api/viral/backtest/{reportId}) */
  async getApiViralBacktestReportid<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/viral/backtest/{reportId}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get corpus metadata for platform+niche (JSON envelope; file streaming not yet implemented) (GET /api/viral/corpus/{platform}/{niche}) */
  async getApiViralCorpusPlatformNiche<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/viral/corpus/{platform}/{niche}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Trigger a viral mining job (POST /api/viral/mine) */
  async postApiViralMine<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/viral/mine';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }

  /** Cancel a running mining job (DELETE /api/viral/mine/{jobId}) */
  async deleteApiViralMineJobid<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'DELETE', headers };
    let url = this.baseUrl + '/api/viral/mine/{jobId}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get mining job status/progress (GET /api/viral/mine/{jobId}) */
  async getApiViralMineJobid<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/viral/mine/{jobId}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List all supported platforms with categories (GET /api/viral/platforms) */
  async getApiViralPlatforms<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/viral/platforms';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List all available viral stats (GET /api/viral/stats) */
  async getApiViralStats<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/viral/stats';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Get latest viral stats for platform+niche (GET /api/viral/stats/{platform}/{niche}) */
  async getApiViralStatsPlatformNiche<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      // no auth scheme declared
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/viral/stats/{platform}/{niche}';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** List executable automation workflows (GET /api/workflows) */
  async getApiWorkflows<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    const init: RequestInit = { method: 'GET', headers };
    let url = this.baseUrl + '/api/workflows';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    return this.request<T>(url, init);
  }

  /** Trigger a workflow execution (POST /api/workflows/run) */
  async postApiWorkflowsRun<T = unknown>(opts: { params?: Record<string, string | number | boolean>; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string> } & { body?: unknown } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...opts.headers };
      if (this.sessionCookie) headers['x-session-cookie'] = this.sessionCookie;
    const init: RequestInit = { method: 'POST', headers };
    let url = this.baseUrl + '/api/workflows/run';
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url = url.replaceAll('{' + k + '}', encodeURIComponent(String(v)));
      }
    }
    if (opts.query) {
      const filtered = Object.entries(opts.query).filter(([_, v]) => v != null);
      if (filtered.length > 0) {
        const q = new URLSearchParams(filtered.map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + q.toString();
      }
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.request<T>(url, init);
  }
}
