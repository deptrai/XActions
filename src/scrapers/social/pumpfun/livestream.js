// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Livestream status — background poller keeps an in-memory set of currently-live
 * mint addresses so `isLive(mint)` resolves in 0ms per request (no per-mint call).
 *
 * Phase 1: no WebSocket chat — polling `/coins/currently-live` only.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const DEFAULT_INTERVAL_MS = 30 * 1000;

export class LivestreamPoller {
  /**
   * @param {Object} deps
   * @param {import('./client.js').PumpFunClient} deps.client
   * @param {number} [deps.intervalMs]
   * @param {boolean} [deps.autoStart]
   */
  constructor(deps = {}) {
    if (!deps.client) {
      throw new Error('LivestreamPoller requires a PumpFunClient (deps.client)');
    }
    this.client = deps.client;
    this.intervalMs = Number.isFinite(deps.intervalMs) ? deps.intervalMs : DEFAULT_INTERVAL_MS;
    /** @type {Map<string, { viewers: number, roomId?: string }>} mint → live info */
    this._live = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    this._timer = null;
    this._running = false;
    if (deps.autoStart !== false) this.start();
  }

  /** Start the background poller (idempotent). */
  start() {
    if (this._running) return;
    this._running = true;
    void this.#tick();
    this._timer = setInterval(() => { void this.#tick(); }, this.intervalMs);
    this._timer.unref?.();
  }

  /** Stop the background poller. */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async #tick() {
    try {
      const coins = await this.client.getCurrentlyLive();
      const next = new Map();
      for (const coin of Array.isArray(coins) ? coins : []) {
        if (!coin || typeof coin !== 'object') continue;
        const mint = coin.mint || coin.coinMint || coin.id;
        if (!mint) continue;
        next.set(String(mint), {
          viewers: Number(coin.viewers ?? coin.num_viewers ?? coin.liveViewers ?? 0) || 0,
          roomId: coin.roomId || coin.livestream_id || coin.livestreamId || undefined,
        });
      }
      this._live = next;
    } catch {
      // Poller failure is non-fatal: keep the previous set, retry next tick.
    }
  }

  /**
   * 0ms in-memory lookup for livestream status.
   * @param {string} mint
   * @returns {{ isActive: boolean, viewers: number, roomId?: string }}
   */
  isLive(mint) {
    const info = this._live.get(String(mint));
    if (!info) return { isActive: false, viewers: 0 };
    return { isActive: true, viewers: info.viewers, ...(info.roomId ? { roomId: info.roomId } : {}) };
  }

  /** Number of mints currently tracked as live. */
  get size() {
    return this._live.size;
  }
}

export function createLivestreamPoller(deps = {}) {
  return new LivestreamPoller(deps);
}

export default LivestreamPoller;
