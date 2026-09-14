// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP local-tools & server helper tests
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('local-tools browser lifecycle and parameter compatibility', () => {
  it('exports getPage, getBrowser, closeBrowser as functions', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    assert.equal(typeof mod.getPage, 'function', 'getPage must be a function');
    assert.equal(typeof mod.getBrowser, 'function', 'getBrowser must be a function');
    assert.equal(typeof mod.closeBrowser, 'function', 'closeBrowser must be a function');
  });

  it('toolMap contains getPage, getBrowser, and closeBrowser', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    const map = mod.toolMap;
    assert.ok(map, 'toolMap must exist');
    assert.equal(typeof map.getPage, 'function', 'toolMap.getPage must be a function');
    assert.equal(typeof map.getBrowser, 'function', 'toolMap.getBrowser must be a function');
    assert.equal(typeof map.closeBrowser, 'function', 'toolMap.closeBrowser must be a function');
  });

  it('x_like throws clear error when neither url nor tweetUrl is provided', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    await assert.rejects(
      async () => await mod.x_like({}),
      /url or tweetUrl is required for x_like/
    );
  });

  it('x_like accepts tweetUrl alone without throwing argument validation error', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    try {
      await mod.x_like({ tweetUrl: 'https://x.com/user/status/123456' });
    } catch (err) {
      assert.notMatch(err.message, /url or tweetUrl is required for x_like/);
    }
  });

  it('x_retweet throws clear error when neither url nor tweetUrl is provided', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    await assert.rejects(
      async () => await mod.x_retweet({}),
      /url or tweetUrl is required for x_retweet/
    );
  });

  it('x_retweet accepts tweetUrl alone without throwing argument validation error', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    try {
      await mod.x_retweet({ tweetUrl: 'https://x.com/user/status/123456' });
    } catch (err) {
      assert.notMatch(err.message, /url or tweetUrl is required for x_retweet/);
    }
  });

  it('x_download_video throws clear error when neither tweetUrl nor url is provided', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    await assert.rejects(
      async () => await mod.x_download_video({}),
      /tweetUrl or url is required for x_download_video/
    );
  });

  it('x_delete_tweet throws clear error when neither url nor tweetUrl is provided', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    await assert.rejects(
      async () => await mod.x_delete_tweet({}),
      /url or tweetUrl is required for x_delete_tweet/
    );
  });

  it('x_reply throws clear error when neither url nor tweetUrl is provided', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    await assert.rejects(
      async () => await mod.x_reply({ text: 'test' }),
      /url or tweetUrl is required for x_reply/
    );
  });

  it('x_bookmark throws clear error when neither url nor tweetUrl is provided', async () => {
    const mod = await import('../../src/mcp/local-tools.js');
    await assert.rejects(
      async () => await mod.x_bookmark({}),
      /url or tweetUrl is required for x_bookmark/
    );
  });
});
