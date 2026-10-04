// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunLivechat tests — REAL `ws` server (deferred item from spec-20-5 review).
 *
 * Spins up a WebSocketServer from the `ws` package on an ephemeral port and
 * mocks the Engine.IO v4 / Socket.IO handshake server-side:
 *   server → '0{"sid":...}'   (EIO_OPEN)
 *   client → '40' | '40{auth}' (SIO_CONNECT, with auth payload when token set)
 *   server → '40{"sid":...}'  (SIO_CONNECT ack → client connect() resolves)
 * Then asserts real wire packets: joinRoom/getMessageHistory emit + ack frames,
 * EIO_PING → EIO_PONG, and pending-ack null resolution on mid-flight close.
 * @author nich (@nichxbt)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { PumpFunLivechat } from '../../../../src/scrapers/social/pumpfun/livechat.js';

const VALID_MINT = 'mint123';

/* Engine.IO v4 / Socket.IO packet prefixes (mirror livechat.js constants). */
const EIO_OPEN = '0';
const EIO_PING = '2';
const EIO_PONG = '3';
const SIO_CONNECT = '40';
const SIO_EVENT = '42';
const SIO_ACK = '43';

const CHAT_MESSAGE = {
  id: 'm1',
  roomId: VALID_MINT,
  message: 'gm',
  username: 'trader1',
  userAddress: 'WALLET1111111111111111111111111111111111111',
  profile_image: null,
  timestamp: 1758013154278,
  messageType: 'text',
  expiresAt: null,
  isModerator: false,
  isCreator: false,
  userId: 'u1',
};

/** @typedef {{ frames: string[], sentFrames: string[], sockets: import('ws').WebSocket[], requestUrls: string[], events: { id: number, event: string, payload: any, acked?: boolean }[] }} LivechatState */
/** @typedef {{ wss: WebSocketServer, state: LivechatState, url: string, close: () => Promise<void> }} LivechatServer */

/**
 * Real `ws` server on an ephemeral port that mocks the pump.fun livechat
 * handshake. Every frame the server receives is recorded in `state.frames`.
 * @param {(socket: import('ws').WebSocket, state: LivechatState) => void} [onConnection]
 *   extra per-connection wiring (e.g. custom ack responders).
 * @returns {Promise<LivechatServer>}
 */
async function startLivechatServer(onConnection) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => { wss.on('listening', resolve); });

  /** @type {LivechatState} */
  const state = {
    frames: [],
    sentFrames: [],
    sockets: [],
    requestUrls: [],
    events: [],
  };
  /** @param {import('ws').WebSocket} socket @param {string} frame */
  const send = (socket, frame) => { state.sentFrames.push(frame); socket.send(frame); };

  wss.on('connection', (socket, req) => {
    state.sockets.push(socket);
    state.requestUrls.push(req.url ?? '');

    socket.on('message', (data) => {
      const msg = data.toString();
      state.frames.push(msg);

      // Parsed SIO_EVENT bookkeeping (42<id>["event",payload]).
      if (msg.startsWith(SIO_EVENT)) {
        const rest = msg.slice(SIO_EVENT.length);
        const idMatch = rest.match(/^\d+/);
        if (idMatch) {
          try {
            const [event, payload] = JSON.parse(rest.slice(idMatch[0].length));
            state.events.push({ id: Number(idMatch[0]), event, payload });
          } catch { /* ignore malformed */ }
        }
      }

      // Complete the Socket.IO handshake for any SIO_CONNECT frame
      // (bare '40' or '40{...auth}').
      if (msg.startsWith(SIO_CONNECT)) {
        send(socket, `${SIO_CONNECT}{"sid":"srv-session"}`);
      }
    });

    // Engine.IO open packet — starts the handshake.
    send(socket, `${EIO_OPEN}{"sid":"srv-open"}`);
    onConnection?.(socket, state);
  });

  const port = /** @type {import('net').AddressInfo} */ (wss.address()).port;
  /** @type {LivechatServer} */
  const server = {
    wss,
    state,
    url: `ws://127.0.0.1:${port}`,
    close: async () => {
      for (const s of state.sockets) { try { s.terminate(); } catch { /* noop */ } }
      await new Promise((resolve) => { wss.close(() => resolve(undefined)); });
    },
  };
  openServers.push(server);
  return server;
}

/** Poll until a frame matching `pred` arrives (deterministic, bounded).
 * @param {LivechatState} state
 * @param {(m: string) => boolean} pred
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
async function waitForFrame(state, pred, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = state.frames.find(pred);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`frame not received within ${timeoutMs}ms`);
    await new Promise((r) => { setTimeout(r, 10); });
  }
}

/** Send a Socket.IO ack frame `43<id>[<json>]` back to the client.
 * @param {import('ws').WebSocket} socket
 * @param {number} id
 * @param {any} response
 */
function sendAck(socket, id, response) {
  socket.send(`${SIO_ACK}${id}${JSON.stringify([response])}`);
}

/* --------------------------- cleanup registry --------------------------- */

/** @type {ReturnType<typeof startLivechatServer> extends Promise<infer T> ? T[] : never[]} */
const openServers = /** @type {any[]} */ ([]);
/** @type {PumpFunLivechat[]} */
const openClients = [];

/** @param {string} url @param {Partial<ConstructorParameters<typeof PumpFunLivechat>[0]>} [options] @returns {PumpFunLivechat} */
function makeClient(url, options = {}) {
  const client = new PumpFunLivechat({ url, timeoutMs: 2000, ...options });
  openClients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of openClients) { try { await client.close(); } catch { /* noop */ } }
  openClients.length = 0;
  for (const server of openServers) { try { await server.close(); } catch { /* noop */ } }
  openServers.length = 0;
});

/* --------------------------------- tests -------------------------------- */

describe('PumpFunLivechat (real ws server)', () => {
  it('connect() completes the real Engine.IO/Socket.IO handshake', async () => {
    const server = await startLivechatServer();
    const client = makeClient(server.url);

    await expect(client.connect()).resolves.toBeUndefined();

    // Client hit the Socket.IO websocket endpoint with the right query.
    expect(server.state.requestUrls).toEqual(['/socket.io/?EIO=4&transport=websocket']);

    // Server sent the Engine.IO open packet, then received the bare
    // SIO_CONNECT back (no token → no auth payload).
    const connectFrame = await waitForFrame(server.state, (m) => m.startsWith(SIO_CONNECT));
    expect(connectFrame).toBe(SIO_CONNECT);
    expect(server.state.sentFrames[0]).toBe(`${EIO_OPEN}{"sid":"srv-open"}`);
  });

  it('joinRoom sends the 42<id>["joinRoom",{roomId}] packet and resolves the 43 ack payload', async () => {
    const ackPayload = { authenticated: true, isCreator: false, roomConfig: { tokenGateEnabled: false } };
    const server = await startLivechatServer();
    const client = makeClient(server.url);
    await client.connect();

    // Wire the ack responder to joinRoom events as they arrive.
    const acker = setInterval(() => {
      for (const ev of server.state.events) {
        if (ev.event === 'joinRoom' && !ev.acked) { ev.acked = true; sendAck(server.state.sockets[0], ev.id, ackPayload); }
      }
    }, 10);

    try {
      const result = await client.joinRoom(VALID_MINT);
      expect(result).toEqual(ackPayload);
    } finally {
      clearInterval(acker);
    }

    // Exact wire format: 42<ackId>["joinRoom",{"roomId":"mint123"}]
    const joinEvent = server.state.events.find((e) => e.event === 'joinRoom');
    expect(joinEvent).toBeDefined();
    expect(joinEvent?.id).toBe(0); // first emit → ackId 0
    expect(joinEvent?.payload).toEqual({ roomId: VALID_MINT });
    const expectedPacket = `${SIO_EVENT}0${JSON.stringify(['joinRoom', { roomId: VALID_MINT }])}`;
    expect(server.state.frames).toContain(expectedPacket);
  });

  it('getMessageHistory joins the room, emits getMessageHistory, and unwraps an object ack', async () => {
    const joinAck = { authenticated: true, isCreator: false, roomConfig: {} };
    const historyAck = { messages: [CHAT_MESSAGE], nextCursor: 'cursor-1' };
    const server = await startLivechatServer();
    const client = makeClient(server.url);
    await client.connect();

    const acker = setInterval(() => {
      for (const ev of server.state.events) {
        if (ev.acked) continue;
        if (ev.event === 'joinRoom') { ev.acked = true; sendAck(server.state.sockets[0], ev.id, joinAck); }
        if (ev.event === 'getMessageHistory') { ev.acked = true; sendAck(server.state.sockets[0], ev.id, historyAck); }
      }
    }, 10);

    let result;
    try {
      result = await client.getMessageHistory(VALID_MINT, { limit: 25 });
    } finally {
      clearInterval(acker);
    }

    expect(result).toEqual({ messages: [CHAT_MESSAGE], nextCursor: 'cursor-1' });

    const historyEvent = server.state.events.find((e) => e.event === 'getMessageHistory');
    expect(historyEvent).toBeDefined();
    expect(historyEvent?.id).toBe(1); // joinRoom consumed ackId 0
    expect(historyEvent?.payload).toEqual({ roomId: VALID_MINT, limit: 25 });

    // joinRoom was emitted first (server requires room membership).
    const joinIdx = server.state.events.findIndex((e) => e.event === 'joinRoom');
    const historyIdx = server.state.events.findIndex((e) => e.event === 'getMessageHistory');
    expect(joinIdx).toBeGreaterThanOrEqual(0);
    expect(joinIdx).toBeLessThan(historyIdx);
  });

  it('getMessageHistory unwraps a bare array ack into { messages, nextCursor: null }', async () => {
    const server = await startLivechatServer();
    const client = makeClient(server.url);
    await client.connect();

    const acker = setInterval(() => {
      for (const ev of server.state.events) {
        if (ev.acked) continue;
        if (ev.event === 'joinRoom') { ev.acked = true; sendAck(server.state.sockets[0], ev.id, { authenticated: true }); }
        if (ev.event === 'getMessageHistory') {
          ev.acked = true;
          // Server replies with a bare array of messages (no wrapper object).
          sendAck(server.state.sockets[0], ev.id, [CHAT_MESSAGE, { ...CHAT_MESSAGE, id: 'm2' }]);
        }
      }
    }, 10);

    let result;
    try {
      result = await client.getMessageHistory(VALID_MINT);
    } finally {
      clearInterval(acker);
    }

    expect(result).toEqual({ messages: [CHAT_MESSAGE, { ...CHAT_MESSAGE, id: 'm2' }], nextCursor: null });
  });

  it('replies to an EIO_PING from the server with EIO_PONG', async () => {
    const server = await startLivechatServer();
    const client = makeClient(server.url);
    await client.connect();

    server.state.sockets[0].send(EIO_PING);

    const pong = await waitForFrame(server.state, (m) => m === EIO_PONG);
    expect(pong).toBe(EIO_PONG);
  });

  it('close() closes the underlying socket (server observes the close)', async () => {
    const server = await startLivechatServer();
    const client = makeClient(server.url);
    await client.connect();

    const closed = new Promise((resolve) => {
      const sock = server.state.sockets[0];
      sock.on('close', resolve);
    });

    await client.close();
    await expect(closed).resolves.toBeDefined(); // close event fired with any code
    expect(client._ws).toBeNull();
    expect(client._ready).toBeNull();
  });

  it('pending acks resolve null when the socket closes mid-flight', async () => {
    const server = await startLivechatServer();
    const client = makeClient(server.url, { timeoutMs: 60_000 }); // must NOT win the race — only close resolves it
    await client.connect();

    // Emit joinRoom but never ack it server-side.
    const joinPromise = client.joinRoom(VALID_MINT);
    await waitForFrame(server.state, (m) => m.startsWith(`${SIO_EVENT}0`));

    // Kill the connection mid-flight — pending ack must resolve null, not hang.
    server.state.sockets[0].terminate();

    await expect(joinPromise).resolves.toBeNull();
  });

  it('setAuthToken sends the token in the Socket.IO connect auth payload', async () => {
    const server = await startLivechatServer();
    const client = makeClient(server.url);
    client.setAuthToken('secret-auth-token');
    client._deviceId = 'device-test-1';

    await expect(client.connect()).resolves.toBeUndefined();

    const authFrame = await waitForFrame(server.state, (m) => m.startsWith(`${SIO_CONNECT}{`));
    const auth = JSON.parse(authFrame.slice(SIO_CONNECT.length));
    expect(auth.token).toBe('secret-auth-token');
    expect(auth.origin).toBe('https://pump.fun');
    expect(auth.deviceId).toBe('device-test-1');
    expect(typeof auth.timestamp).toBe('number');
  });
});
