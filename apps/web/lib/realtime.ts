// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Browser-side realtime client & polling fallback helper.
 * Connects to NEXT_PUBLIC_SOCKET_URL via socket.io-client when available,
 * passing session cookies in handshake.
 *
 * Falls back gracefully to api('GET', '/api/health') polling every 10s
 * when socket.io-client is not installed or socket connection fails.
 */

import { api } from './api';

export type RealtimeStatus = 'connected' | 'disconnected' | 'polling' | 'connecting';

export interface RealtimeEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

export interface RealtimeOptions {
  url?: string;
  pollingIntervalMs?: number;
  autoConnect?: boolean;
}

export interface SystemHealthData {
  status?: string;
  timestamp?: number | string;
  uptime?: number;
  hibernating?: boolean;
  activeAutomations?: number;
  queueLength?: number;
  memoryUsage?: {
    rss?: number;
    heapUsed?: number;
    heapTotal?: number;
  };
  services?: Record<string, { status: string; latency?: number; message?: string }>;
  [key: string]: unknown;
}

type EventListener<T> = (data: T) => void;

/**
 * Socket.IO interface minimal type signature to avoid requiring socket.io-client
 * as a compile-time hard dependency.
 */
interface MinimalSocket {
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback?: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  disconnect(): void;
  close(): void;
  connected: boolean;
}

export class RealtimeClient {
  private socketUrl: string;
  private pollingIntervalMs: number;
  private status: RealtimeStatus = 'disconnected';
  private socket: MinimalSocket | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Map<string, Set<EventListener<unknown>>> = new Map();
  private statusListeners: Set<(status: RealtimeStatus) => void> = new Set();
  private lastHealthData: SystemHealthData | null = null;

  constructor(options: RealtimeOptions = {}) {
    // Zero-hardcode compliant socket URL resolution:
    // Respects NEXT_PUBLIC_SOCKET_URL if set in env/window, otherwise defaults to origin
    const defaultHost = typeof window !== 'undefined' ? window.location.origin : '';
    this.socketUrl = options.url || process.env.NEXT_PUBLIC_SOCKET_URL || defaultHost;
    this.pollingIntervalMs = options.pollingIntervalMs || 10000;

    if (options.autoConnect) {
      this.connect();
    }
  }

  public getStatus(): RealtimeStatus {
    return this.status;
  }

  public getLastHealthData(): SystemHealthData | null {
    return this.lastHealthData;
  }

  public onStatusChange(callback: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private setStatus(newStatus: RealtimeStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      for (const listener of this.statusListeners) {
        try {
          listener(newStatus);
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  public async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.setStatus('connecting');

    // Attempt dynamic import of socket.io-client
    let ioModule: unknown = null;
    try {
      const pkg = 'socket.io-client';
      ioModule = await import(/* webpackIgnore: true */ pkg);
    } catch {
      ioModule = null;
    }

    if (ioModule && typeof (ioModule as { io?: unknown; default?: unknown }).io === 'function' || typeof (ioModule as { default?: unknown }).default === 'function') {
      try {
        const ioFunc = (ioModule as { io?: (...args: unknown[]) => MinimalSocket; default?: (...args: unknown[]) => MinimalSocket }).io ||
          (ioModule as { default: (...args: unknown[]) => MinimalSocket }).default;

        const socket = ioFunc(this.socketUrl, {
          withCredentials: true,
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 2,
          timeout: 4000,
        });

        socket.on('connect', () => {
          this.socket = socket;
          this.stopPolling();
          this.setStatus('connected');
          this.emitInternal('connect', { timestamp: Date.now() });
        });

        socket.on('disconnect', () => {
          this.setStatus('disconnected');
          this.startPolling();
        });

        socket.on('connect_error', () => {
          this.startPolling();
        });

        // Forward general events
        const eventNames = ['job:progress', 'job:event', 'health:update', 'operation:update', 'status'];
        for (const name of eventNames) {
          socket.on(name, (data: unknown) => {
            this.emitInternal(name, data);
          });
        }

        return;
      } catch {
        // Socket initialization failed, fallback to polling
      }
    }

    // Socket.io unavailable or failed -> Fallback to polling
    this.startPolling();
  }

  public disconnect(): void {
    this.stopPolling();
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        // ignore disconnect errors
      }
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  /**
   * Starts periodic polling fallback via api('GET', '/api/health') every 10s
   */
  public startPolling(): void {
    if (this.status !== 'polling') {
      this.setStatus('polling');
    }

    if (this.pollingTimer) {
      return;
    }

    // Execute first poll immediately
    this.pollHealth();

    this.pollingTimer = setInterval(() => {
      this.pollHealth();
    }, this.pollingIntervalMs);
  }

  public stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  public async pollHealth(): Promise<SystemHealthData | null> {
    try {
      const res = await api<SystemHealthData>('GET', '/api/health');
      if (res.ok && res.data) {
        this.lastHealthData = res.data;
        this.emitInternal('health:update', res.data);
        this.emitInternal('job:event', {
          id: `poll-${Date.now()}`,
          level: 'info',
          message: `Health poll received: ${res.data.status || 'OK'}`,
          timestamp: Date.now(),
        });
        return res.data;
      }
    } catch {
      // network/fetch error during polling
    }
    return null;
  }

  public subscribe<T = unknown>(event: string, listener: EventListener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as EventListener<unknown>);

    return () => {
      const existing = this.listeners.get(event);
      if (existing) {
        existing.delete(listener as EventListener<unknown>);
        if (existing.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  public emitInternal<T = unknown>(event: string, data: T): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch {
          // ignore callback error
        }
      }
    }

    // Also forward to wildcard '*' listeners
    const wildcardSet = this.listeners.get('*');
    if (wildcardSet) {
      const envelope: RealtimeEvent<T> = {
        type: event,
        payload: data,
        timestamp: Date.now(),
      };
      for (const listener of wildcardSet) {
        try {
          listener(envelope);
        } catch {
          // ignore
        }
      }
    }
  }
}

// Singleton instance for app-wide sharing
let globalRealtimeClient: RealtimeClient | null = null;

export function getRealtimeClient(options?: RealtimeOptions): RealtimeClient {
  if (!globalRealtimeClient) {
    globalRealtimeClient = new RealtimeClient({
      autoConnect: true,
      ...options,
    });
  }
  return globalRealtimeClient;
}
