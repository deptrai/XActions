// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunLivechat — Socket.IO client for `wss://livechat.pump.fun`.
 *
 * pump.fun v3 moved coin comments/replies off REST (GET /replies/{mint} → 404)
 * onto a Socket.IO livechat service. Rooms are keyed by mint address.
 *
 * Discovered protocol (live-probed 2026-09-25 from the pump.fun web bundle):
 *   transport : Engine.IO v4 over WebSocket (`/socket.io/?EIO=4&transport=websocket`)
 *   emit      : "joinRoom"          { roomId: <mint>, username?: string }   → ack { authenticated, isCreator, roomConfig }
 *   emit      : "getMessageHistory" { roomId: <mint>, before?: ms, limit }  → ack { messages[] , nextCursor? } | messages[]
 *   events    : "newMessage" | "message" | "pinnedMessage" ... (streamed post-join)
 *   emits     : "leaveRoom" { roomId }, "sendMessage", "viewerHeartbeat",
 *               "addReaction", "removeReaction", "pinMessage", "unpinMessage"
 *
 * Message shape (ack payload element):
 *   { id, roomId, message, username, userAddress, profile_image, timestamp,
 *     messageType, expiresAt, isModerator, isCreator, userId, replyToId?, replyPreview? }
 *
 * No auth token is required to read history; `tokenGateEnabled` on the room
 * only gates *posting*, not reading.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import WebSocket from 'ws';

export const PUMPFUN_LIVECHAT_WS = 'wss://livechat.pump.fun';

/** Socket.IO packet type prefixes (Engine.IO v4). */
const EIO_OPEN = '0';
const EIO_PING = '2';
const EIO_PONG = '3';
const SIO_CONNECT = '40';
const SIO_EVENT = '42';
const SIO_ACK = '43';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Minimal Socket.IO v4 client over `ws` — just enough to join a room and pull
 * message history. No reconnection logic: callers open → query → close.
 */
export class PumpFunLivechat {
  /**
   * @param {object} [options]
   * @param {string} [options.url]        livechat ws base
   * @param {number} [options.timeoutMs]  per-operation timeout
   * @param {object} [options.headers]    extra ws headers (Origin spoof is default)
   * @param {WebSocket} [options.webSocketImpl] injectable ws impl for tests
   */
  constructor(options = {}) {
    this.url = options.url || PUMPFUN_LIVECHAT_WS;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.headers = {
      Origin: 'https://pump.fun',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ...(options.headers || {}),
    };
    /** @type {WebSocket | null} */
    this._ws = null;
    /** Injectable ws implementation (tests / custom transports). */
    this._WSImpl = options.webSocketImpl || null;
    /** @type {number} */
    this._ackId = 0;
    /** @type {Map<number, { resolve: Function, timer: NodeJS.Timeout }>} */
    this._pendingAcks = new Map();
    /** @type {Function | null} */
    this._onEvent = null;
    /** @type {Promise<void> | null} */
    this._ready = null;
  }

  /**
   * Open the ws, complete Engine.IO + Socket.IO handshake.
   * @returns {Promise<void>}
   */
  connect() {
    if (this._ready) return this._ready;
    const WS = this._WSImpl || WebSocket;
    this._ws = new WS(`${this.url}/socket.io/?EIO=4&transport=websocket`, { headers: this.headers });

    this._ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('livechat connect timeout')), this.timeoutMs);
      this._ws.on('message', (d) => this.#onMessage(d, resolve, timer));
      this._ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      this._ws.on('close', () => {
        // Reject all pending acks so callers never hang.
        for (const [, p] of this._pendingAcks) { clearTimeout(p.timer); p.resolve(null); }
        this._pendingAcks.clear();
      });
    });
    return this._ready;
  }

  /**
   * Join a coin's chat room. Required before getMessageHistory on some rooms.
   * @param {string} mint
   * @param {string} [username]
   * @returns {Promise<object|null>} join ack payload (roomConfig, flags)
   */
  async joinRoom(mint, username) {
    await this.connect();
    const payload = { roomId: mint };
    if (username) payload.username = username;
    const ack = await this.#emitWithAck('joinRoom', payload);
    return ack ?? null;
  }

  /**
   * Fetch chat history for a mint. `before` is ms epoch; omit for latest page.
   * @param {string} mint
   * @param {{ before?: number, limit?: number }} [opts]
   * @returns {Promise<{ messages: any[], nextCursor: any }>}
   */
  async getMessageHistory(mint, opts = {}) {
    await this.connect();
    // joinRoom first — server requires room membership for history on gated rooms.
    await this.joinRoom(mint);
    const payload = { roomId: mint };
    if (Number.isFinite(opts.before)) payload.before = opts.before;
    payload.limit = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_HISTORY_LIMIT;
    const ack = await this.#emitWithAck('getMessageHistory', payload);
    if (Array.isArray(ack)) return { messages: ack, nextCursor: null };
    if (ack && typeof ack === 'object') {
      return {
        messages: Array.isArray(ack.messages) ? ack.messages : [],
        nextCursor: ack.nextCursor ?? null,
      };
    }
    return { messages: [], nextCursor: null };
  }

  /**
   * Register a handler for pushed events (newMessage, pinnedMessage, ...).
   * @param {(event: string, data: any) => void} fn
   */
  onEvent(fn) { this._onEvent = fn; }

  /** Leave the room and close the socket. */
  async close() {
    try { this._ws?.close(); } catch { /* noop */ }
    this._ws = null;
    this._ready = null;
  }

  /* ------------------------------ internals ------------------------------ */

  /**
   * Emit a Socket.IO event expecting an ack response.
   * @param {string} event
   * @param {any} payload
   * @returns {Promise<any>}
   */
  #emitWithAck(event, payload) {
    const id = this._ackId++;
    const packet = `${SIO_EVENT}${id}${JSON.stringify([event, payload])}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pendingAcks.delete(id);
        resolve(null);
      }, this.timeoutMs);
      this._pendingAcks.set(id, { resolve, timer });
      try { this._ws.send(packet); } catch { clearTimeout(timer); this._pendingAcks.delete(id); resolve(null); }
    });
  }

  /**
   * Demux incoming ws frames: Engine.IO open/ping, Socket.IO connect/event/ack.
   */
  #onMessage(data, resolveConnect, connectTimer) {
    const msg = data.toString();
    if (msg.startsWith(EIO_OPEN)) {
      this._ws.send(SIO_CONNECT);
      return;
    }
    if (msg === EIO_PING) { this._ws.send(EIO_PONG); return; }
    if (msg.startsWith(SIO_CONNECT)) {
      clearTimeout(connectTimer);
      resolveConnect();
      return;
    }
    if (msg.startsWith(SIO_ACK)) {
      // 43<ackId><json>
      const rest = msg.slice(SIO_ACK.length);
      const idMatch = rest.match(/^\d+/);
      if (!idMatch) return;
      const id = Number(idMatch[0]);
      const jsonStart = rest.slice(idMatch[0].length);
      const pending = this._pendingAcks.get(id);
      if (!pending) return;
      this._pendingAcks.delete(id);
      clearTimeout(pending.timer);
      try { pending.resolve(JSON.parse(jsonStart)?.[0] ?? null); }
      catch { pending.resolve(null); }
      return;
    }
    if (msg.startsWith(SIO_EVENT)) {
      try {
        const arr = JSON.parse(msg.slice(SIO_EVENT.length));
        if (this._onEvent && Array.isArray(arr)) this._onEvent(arr[0], arr[1]);
      } catch { /* ignore malformed */ }
    }
  }
}

export default PumpFunLivechat;
