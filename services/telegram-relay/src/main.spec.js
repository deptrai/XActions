import test from "node:test";
import assert from "node:assert/strict";
import {
  createRelayServer,
  validateStartupEnv,
  tokenMatches,
  extractToken,
} from "./main.js";

const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

test("validateStartupEnv checks required parameters", () => {
  const invalid = validateStartupEnv({
    apiId: 0,
    apiHash: "",
    session: "",
    authToken: "too_short",
  });
  assert.equal(invalid.length, 4);

  const valid = validateStartupEnv({
    apiId: 12345,
    apiHash: "valid_hash",
    session: "valid_session",
    authToken: VALID_TOKEN,
  });
  assert.equal(valid.length, 0);
});

test("tokenMatches uses timing-safe equal and handles edge cases", () => {
  assert.equal(tokenMatches("secret", "secret"), true);
  assert.equal(tokenMatches("secret", "other"), false);
  assert.equal(tokenMatches("", "secret"), false);
  assert.equal(tokenMatches(null, "secret"), false);
});

test("extractToken extracts Bearer and x-relay-token", () => {
  assert.equal(extractToken({ headers: { authorization: "Bearer my-token" } }), "my-token");
  assert.equal(extractToken({ headers: { authorization: "bearer   my-token  " } }), "my-token");
  assert.equal(extractToken({ headers: { "x-relay-token": "alt-token" } }), "alt-token");
  assert.equal(extractToken({ headers: {} }), "");
});

test("createRelayServer endpoints, health states, and error handling", async () => {
  const fakeClient = {
    connected: true,
    connect: async () => {},
    disconnect: async () => {},
    getEntity: async (channel) => ({
      id: 9999,
      username: channel,
      title: "Test Channel",
      participantsCount: 1234,
      about: "A crypto channel",
    }),
    getMessages: async (_entity, opts) => [
      {
        id: 101,
        date: 1710000000,
        message: "Bitcoin breaks 70k $BTC",
        views: 500,
        forwards: 12,
        postAuthor: "Admin",
      },
    ],
    getDialogs: async () => [
      { id: 9999, title: "Test Channel", isChannel: true, isGroup: false, unreadCount: 0 },
    ],
  };

  const server = createRelayServer({
    authToken: VALID_TOKEN,
    client: fakeClient,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /liveness is unauthenticated
    const liveRes = await fetch(`${baseUrl}/liveness`);
    assert.equal(liveRes.status, 200);
    const liveJson = await liveRes.json();
    assert.deepEqual(liveJson, { ok: true, status: "ok" });

    // 2. GET /health without auth -> 401
    const unauthHealth = await fetch(`${baseUrl}/health`);
    assert.equal(unauthHealth.status, 401);

    // 3. GET /health with auth -> 200 healthy
    const healthyRes = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    assert.equal(healthyRes.status, 200);
    const healthyJson = await healthyRes.json();
    assert.equal(healthyJson.status, "healthy");

    // 4. GET /health cooldown state
    server._setState({ cooldownUntil: Date.now() + 10000, lastError: "FLOOD_WAIT_10" });
    const cooldownRes = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    assert.equal(cooldownRes.status, 503);
    const cooldownJson = await cooldownRes.json();
    assert.equal(cooldownJson.status, "cooldown");
    assert.equal(cooldownJson.error, "FLOOD_WAIT_10");
    assert.ok(cooldownJson.cooldownMs > 0);

    // 5. GET /health permanently_unhealthy state
    server._setState({ isPermanentlyUnhealthy: true, lastError: "SESSION_BANNED" });
    const permRes = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    assert.equal(permRes.status, 503);
    const permJson = await permRes.json();
    assert.equal(permJson.status, "permanently_unhealthy");

    // Reset state for POST tests
    server._setState({ isPermanentlyUnhealthy: false, cooldownUntil: 0, lastError: null });

    // 6. POST /channel/messages unauthenticated -> 401
    const unauthPost = await fetch(`${baseUrl}/channel/messages`, {
      method: "POST",
      body: JSON.stringify({ channel: "durov" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(unauthPost.status, 401);

    // 7. POST /channel/messages when busy -> 503 RELAY_BUSY
    server._setState({ isBusy: true });
    const busyPost = await fetch(`${baseUrl}/channel/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "durov" }),
    });
    assert.equal(busyPost.status, 503);
    const busyJson = await busyPost.json();
    assert.equal(busyJson.error, "RELAY_BUSY");
    server._setState({ isBusy: false });

    // 8. POST /channel/messages happy path
    const okPost = await fetch(`${baseUrl}/channel/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "durov", limit: 5 }),
    });
    assert.equal(okPost.status, 200);
    const okJson = await okPost.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.channelId, "9999");
    assert.equal(okJson.messages.length, 1);
    assert.equal(okJson.messages[0].id, 101);
    assert.equal(okJson.messages[0].text, "Bitcoin breaks 70k $BTC");

    // 9. POST /channel/info happy path
    const infoPost = await fetch(`${baseUrl}/channel/info`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "durov" }),
    });
    assert.equal(infoPost.status, 200);
    const infoJson = await infoPost.json();
    assert.equal(infoJson.ok, true);
    assert.equal(infoJson.channel.memberCount, 1234);

    // 10. POST /channel/subscribe happy path
    const subPost = await fetch(`${baseUrl}/channel/subscribe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "durov" }),
    });
    assert.equal(subPost.status, 200);
    const subJson = await subPost.json();
    assert.equal(subJson.subscribed, true);

    // 11. POST /dialogs happy path
    const diagPost = await fetch(`${baseUrl}/dialogs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 10 }),
    });
    assert.equal(diagPost.status, 200);
    const diagJson = await diagPost.json();
    assert.equal(diagJson.ok, true);
    assert.equal(diagJson.dialogs.length, 1);

    // 12. FLOOD_WAIT error taxonomy mapping
    server._setState({
      client: {
        getEntity: async () => {
          throw new Error("A wait of 25 seconds is required (caused by GetHistoryRequest)");
        },
      },
    });
    const floodPost = await fetch(`${baseUrl}/channel/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "rate_limited" }),
    });
    assert.equal(floodPost.status, 503);
    const floodJson = await floodPost.json();
    assert.equal(floodJson.error, "FLOOD_WAIT_25");
    const st = server._getState();
    assert.ok(st.cooldownUntil > Date.now());

    // 13. Terminal session error taxonomy mapping
    server._setState({
      cooldownUntil: 0,
      client: {
        getEntity: async () => {
          throw new Error("AUTH_KEY_UNREGISTERED: The key is not registered in the system");
        },
        disconnect: async () => {},
      },
    });
    const terminalPost = await fetch(`${baseUrl}/channel/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "banned" }),
    });
    assert.equal(terminalPost.status, 503);
    const termJson = await terminalPost.json();
    assert.equal(termJson.error, "SESSION_BANNED");
    assert.equal(server._getState().isPermanentlyUnhealthy, true);
  } finally {
    server.close();
  }
});
