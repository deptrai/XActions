/**
 * Telegram Scraper Relay — Single-Session MTProto Relay Service (Story 54.6)
 *
 * Standalone Node.js ESM service holding one MTProto user session via TELEGRAM_SESSION env var.
 * Binds 0.0.0.0:3800 inside container, strictly internal-only, authenticated via RELAY_AUTH_TOKEN.
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 64 * 1024;

export function tokenMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function extractToken(req) {
  const header = req.headers?.authorization;
  if (typeof header === "string") {
    const match = header.match(/^bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const alt = req.headers?.["x-relay-token"];
  return typeof alt === "string" ? alt.trim() : "";
}

export function validateStartupEnv({ apiId, apiHash, session, authToken }) {
  const errors = [];
  if (!apiId || !Number.isFinite(apiId) || apiId <= 0) {
    errors.push("TELEGRAM_API_ID must be a positive integer");
  }
  if (!apiHash || typeof apiHash !== "string" || !apiHash.trim()) {
    errors.push("TELEGRAM_API_HASH is required");
  }
  if (!session || typeof session !== "string" || !session.trim()) {
    errors.push("TELEGRAM_SESSION is required");
  }
  const isHexToken = typeof authToken === "string" && /^[0-9a-fA-F]{32,}$/.test(authToken.trim());
  if (!isHexToken) {
    errors.push("RELAY_AUTH_TOKEN must be at least 32 hexadecimal characters");
  }
  return errors;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readBody(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { ok: false, error: "Request body too large" });
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createRelayServer(options = {}) {
  const authToken = options.authToken ?? process.env.RELAY_AUTH_TOKEN ?? "";
  const apiId = Number(options.apiId ?? process.env.TELEGRAM_API_ID ?? 0);
  const apiHash = options.apiHash ?? process.env.TELEGRAM_API_HASH ?? "";
  const sessionString = options.session ?? process.env.TELEGRAM_SESSION ?? "";

  let client = options.client ?? null;
  let isBusy = false;
  let isPermanentlyUnhealthy = false;
  let cooldownUntil = 0;
  let lastError = null;

  async function getClient() {
    if (client) return client;
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions/index.js");
    const session = new StringSession(sessionString);
    const newClient = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 3,
    });
    if (typeof newClient.setLogLevel === "function") {
      // @ts-ignore
      newClient.setLogLevel("warn");
    }
    await newClient.connect();
    client = newClient;
    return client;
  }

  async function getTelegramApi() {
    if (options.Api) return options.Api;
    try {
      const tg = await import("telegram");
      return tg.Api;
    } catch {
      return null;
    }
  }

  function handleHealth(req, res) {
    if (!tokenMatches(extractToken(req), authToken)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    if (isPermanentlyUnhealthy) {
      sendJson(res, 503, { ok: false, status: "permanently_unhealthy", busy: isBusy, error: lastError });
      return;
    }

    const now = Date.now();
    if (now < cooldownUntil) {
      sendJson(res, 503, {
        ok: false,
        status: "cooldown",
        busy: isBusy,
        error: lastError,
        cooldownMs: cooldownUntil - now,
      });
      return;
    }

    sendJson(res, 200, { ok: true, status: "healthy", busy: isBusy });
  }

  function handleLiveness(_req, res) {
    sendJson(res, 200, { ok: true, status: "ok" });
  }

  async function handleChannelMessages(activeClient, parsed, res) {
    const channel = parsed.channel || parsed.channelName || parsed.handle;
    if (!channel || typeof channel !== "string") {
      sendJson(res, 400, { ok: false, error: "channel is required" });
      return;
    }

    const limit = Number.isFinite(Number(parsed.limit)) && Number(parsed.limit) > 0
      ? Number(parsed.limit)
      : 20;
    const minId = parsed.minId ? Number(parsed.minId) : undefined;
    const maxId = parsed.maxId ? Number(parsed.maxId) : undefined;

    const entity = await activeClient.getEntity(channel);
    const messages = await activeClient.getMessages(entity, { limit, minId, maxId });

    const channelId = entity?.id ? String(entity.id) : String(channel);
    const mapped = (messages || []).map((m) => {
      const fwd = m.fwdFrom ? {
        fromId: m.fwdFrom.fromId?.channelId ? String(m.fwdFrom.fromId.channelId) : (m.fwdFrom.fromId?.userId ? String(m.fwdFrom.fromId.userId) : null),
        fromName: m.fwdFrom.fromName ?? null,
        date: m.fwdFrom.date ?? null,
      } : null;

      return {
        id: m.id,
        channelId,
        date: m.date,
        text: m.message || m.text || "",
        views: m.views ?? null,
        forwards: m.forwards ?? null,
        postAuthor: m.postAuthor ?? null,
        fwdFrom: fwd,
        groupedId: m.groupedId ? String(m.groupedId) : null,
      };
    });

    sendJson(res, 200, { ok: true, channelId, messages: mapped });
  }

  async function handleChannelInfo(activeClient, parsed, res) {
    const channel = parsed.channel || parsed.channelName || parsed.handle;
    if (!channel || typeof channel !== "string") {
      sendJson(res, 400, { ok: false, error: "channel is required" });
      return;
    }

    const entity = await activeClient.getEntity(channel);
    let fullChat = null;
    try {
      const Api = await getTelegramApi();
      if (Api?.channels?.GetFullChannel) {
        const full = await activeClient.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        fullChat = full?.fullChat || null;
      }
    } catch {}

    const title = entity?.title || entity?.username || String(channel);
    const memberCount = fullChat?.participantsCount ?? entity?.participantsCount ?? null;
    const description = fullChat?.about ?? entity?.about ?? null;
    const linkedChatId = fullChat?.linkedChatId ? String(fullChat.linkedChatId) : null;

    sendJson(res, 200, {
      ok: true,
      channel: {
        channel: String(channel),
        channelId: entity?.id ? String(entity.id) : null,
        title,
        memberCount,
        description,
        linkedChatId,
      },
    });
  }

  async function handleSearchChannels(activeClient, parsed, res) {
    const query = parsed.query || parsed.q || "";
    if (!query || typeof query !== "string") {
      sendJson(res, 400, { ok: false, error: "query is required" });
      return;
    }
    const limit = Number(parsed.limit) > 0 ? Number(parsed.limit) : 10;

    let searchResult = null;
    try {
      const Api = await getTelegramApi();
      if (Api?.contacts?.Search) {
        searchResult = await activeClient.invoke(new Api.contacts.Search({ q: query, limit }));
      }
    } catch {
      // Fallback: search dialogs if contacts.Search unavailable
    }

    const chats = searchResult?.chats || [];
    const results = chats.map((c) => ({
      channel: c.username || String(c.id),
      channelId: String(c.id),
      title: c.title || c.username || "",
      memberCount: c.participantsCount ?? null,
      description: null,
    }));

    sendJson(res, 200, { ok: true, results });
  }

  async function handleDialogs(activeClient, parsed, res) {
    const limit = Number(parsed.limit) > 0 ? Number(parsed.limit) : 20;
    const dialogs = await activeClient.getDialogs({ limit });
    const mapped = (dialogs || []).map((d) => ({
      id: d.id ? String(d.id) : null,
      title: d.title || d.name || "",
      isChannel: Boolean(d.isChannel),
      isGroup: Boolean(d.isGroup),
      unreadCount: d.unreadCount ?? 0,
    }));
    sendJson(res, 200, { ok: true, dialogs: mapped });
  }

  async function handleSubscribe(activeClient, parsed, res) {
    const channel = parsed.channel || parsed.channelName || parsed.handle;
    if (!channel || typeof channel !== "string") {
      sendJson(res, 400, { ok: false, error: "channel is required" });
      return;
    }
    const entity = await activeClient.getEntity(channel);
    sendJson(res, 200, { ok: true, subscribed: true, channelId: entity?.id ? String(entity.id) : null });
  }

  async function handlePostRoute(pathname, req, res) {
    if (!tokenMatches(extractToken(req), authToken)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    if (isPermanentlyUnhealthy) {
      sendJson(res, 503, { ok: false, error: "SESSION_BANNED" });
      return;
    }

    const now = Date.now();
    if (now < cooldownUntil) {
      sendJson(res, 503, { ok: false, error: lastError || "COOLDOWN_ACTIVE" });
      return;
    }

    if (isBusy) {
      sendJson(res, 503, { ok: false, error: "RELAY_BUSY" });
      return;
    }
    isBusy = true;

    let body;
    try {
      body = await readBody(req, res);
    } catch (error) {
      isBusy = false;
      throw error;
    }
    if (body === null) {
      isBusy = false;
      return;
    }

    let parsed = {};
    if (body.trim().length > 0) {
      try {
        parsed = JSON.parse(body);
      } catch {
        isBusy = false;
        sendJson(res, 400, { ok: false, error: "Invalid JSON" });
        return;
      }
    }

    try {
      const activeClient = await getClient();

      if (pathname === "/channel/messages") {
        await handleChannelMessages(activeClient, parsed, res);
      } else if (pathname === "/channel/info") {
        await handleChannelInfo(activeClient, parsed, res);
      } else if (pathname === "/channel/search" || pathname === "/search") {
        await handleSearchChannels(activeClient, parsed, res);
      } else if (pathname === "/dialogs") {
        await handleDialogs(activeClient, parsed, res);
      } else if (pathname === "/channel/subscribe") {
        await handleSubscribe(activeClient, parsed, res);
      } else if (pathname === "/relay") {
        // Generic fallback endpoint
        if (parsed.action === "messages" || parsed.channel) {
          await handleChannelMessages(activeClient, parsed, res);
        } else {
          sendJson(res, 200, { ok: true, status: "acknowledged" });
        }
      } else {
        sendJson(res, 404, { ok: false, error: "Not found" });
      }
    } catch (error) {
      const err = /** @type {any} */ (error);
      const errMsg = String(err?.message || err?.errorMessage || "Relay operation failed");

      const floodMatch = errMsg.match(/FLOOD_WAIT_(\d+)/i) || errMsg.match(/wait of (\d+) seconds/i);
      if (floodMatch) {
        const seconds = parseInt(floodMatch[1], 10);
        const cooldownMs = seconds * 1000 + 5000;
        cooldownUntil = Date.now() + cooldownMs;
        lastError = `FLOOD_WAIT_${seconds}`;
        console.error(`[relay] FLOOD_WAIT_${seconds} encountered, cooling down for ${cooldownMs}ms`);
        sendJson(res, 503, { ok: false, error: `FLOOD_WAIT_${seconds}` });
        return;
      }

      const terminalKeywords = [
        "USER_DEACTIVATED_BAN",
        "USER_DEACTIVATED",
        "AUTH_KEY_UNREGISTERED",
        "SESSION_REVOKED",
        "SESSION_EXPIRED",
        "SESSION_BANNED",
      ];
      const isTerminal = terminalKeywords.some((k) => errMsg.includes(k));
      if (isTerminal) {
        isPermanentlyUnhealthy = true;
        lastError = "SESSION_BANNED";
        console.error(`[relay] Terminal session error: ${errMsg}. Marked permanently_unhealthy.`);
        if (client) {
          try { await client.disconnect(); } catch {}
          client = null;
        }
        sendJson(res, 503, { ok: false, error: "SESSION_BANNED" });
        return;
      }

      console.error(`[relay] Error during operation on ${pathname}: ${errMsg}`);
      sendJson(res, 500, { ok: false, error: errMsg });
    } finally {
      isBusy = false;
    }
  }

  const server = /** @type {any} */ (http.createServer((req, res) => {
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
    if (req.method === "GET" && pathname === "/liveness") {
      handleLiveness(req, res);
      return;
    }
    if (req.method === "GET" && pathname === "/health") {
      handleHealth(req, res);
      return;
    }
    if (req.method === "POST") {
      handlePostRoute(pathname, req, res).catch((err) => {
        console.error("[relay] Unhandled relay error:", err.message);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Internal relay error" });
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
  }));

  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;

  // State inspection helpers for testing and diagnostics
  server._getState = () => ({
    isBusy,
    isPermanentlyUnhealthy,
    cooldownUntil,
    lastError,
    client,
  });

  server._setState = (updates = {}) => {
    if (updates.isBusy !== undefined) isBusy = updates.isBusy;
    if (updates.isPermanentlyUnhealthy !== undefined) isPermanentlyUnhealthy = updates.isPermanentlyUnhealthy;
    if (updates.cooldownUntil !== undefined) cooldownUntil = updates.cooldownUntil;
    if (updates.lastError !== undefined) lastError = updates.lastError;
    if (updates.client !== undefined) client = updates.client;
  };

  server._closeClient = async () => {
    if (client) {
      try { await client.disconnect(); } catch {}
      client = null;
    }
  };

  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const session = process.env.TELEGRAM_SESSION || "";
  const authToken = process.env.RELAY_AUTH_TOKEN || "";
  const port = Number(process.env.RELAY_PORT || 3800);
  const host = process.env.RELAY_HOST || "0.0.0.0";

  const errors = validateStartupEnv({ apiId, apiHash, session, authToken });
  if (errors.length > 0) {
    console.error("[relay] Startup validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }

  const server = createRelayServer({
    apiId,
    apiHash,
    session,
    authToken,
    port,
    host,
  });

  server.listen(port, host, () => {
    console.log(`[relay] Telegram Scraper Relay running on ${host}:${port}`);
    console.log("[relay] Endpoints: GET /liveness, GET /health, POST /channel/messages, POST /channel/info");
  });

  const shutdown = async () => {
    console.log("[relay] Shutting down...");
    server.close();
    await server._closeClient();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
