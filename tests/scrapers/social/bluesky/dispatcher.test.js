// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { scrape } from '../../../../src/scrapers/index.js';

describe('Story 23.2: Universal scrape() Dispatcher Integration for Bluesky', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/xrpc/app.bsky.actor.getProfile')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          did: 'did:plc:alice123',
          handle: 'alice.bsky.social',
          displayName: 'Alice In Wonderland',
          followersCount: 50,
          followsCount: 20,
        }));
        return;
      }

      if (req.url?.startsWith('/xrpc/app.bsky.unspecced.getTrendingTopics')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          topics: [
            { topic: 'DispatchTopic', displayName: '#DispatchTopic' },
          ],
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NotFound' }));
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('dispatches scrape("bluesky", "profile", ...) to BlueskyCrawler', async () => {
    const result = await scrape('bluesky', 'profile', {
      handle: 'alice.bsky.social',
      baseUrl: serverUrl,
    });

    expect(result.id).toBe('bluesky:did:plc:alice123');
    expect(result.username).toBe('alice.bsky.social');
  });

  it('dispatches scrape("bsky", "trending", ...) with alias support', async () => {
    const result = await scrape('bsky', 'trending', {
      baseUrl: serverUrl,
    });

    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].id).toBe('bluesky:trend:DispatchTopic');
  });
});
