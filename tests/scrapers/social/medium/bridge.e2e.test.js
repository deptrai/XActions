// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MediumClient } from '../../../../src/scrapers/social/medium/client.js';

const E2E_ENABLED = process.env.MEDIUM_E2E === '1' || process.env.MEDIUM_INTEGRATION === '1';

describe.skipIf(!E2E_ENABLED)('Medium Puppeteer bridge E2E', () => {
  let server;
  let serverUrl;
  let client;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const urlObj = new URL(req.url, 'http://127.0.0.1');

      // Set a basic cookie so the bridge marks isReady.
      res.setHeader('set-cookie', 'sid=e2e; Path=/');

      if (urlObj.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>Medium home</body></html>');
        return;
      }

      if (urlObj.pathname === '/@testuser') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html>
          <head><title>Test User</title></head>
          <body>
            <script>
              window.__APOLLO_STATE__ = {
                'Post:abc123def456': {
                  id: 'abc123def456',
                  title: 'Puppeteer Post',
                  mediumUrl: '${serverUrl}/@testuser/puppeteer-post-abc123def456',
                  firstPublishedAt: 1704067200000,
                },
                'Post:def789abc012': {
                  id: 'def789abc012',
                  title: 'Second Puppeteer Post',
                  mediumUrl: '${serverUrl}/@testuser/second-post-def789abc012',
                  firstPublishedAt: 1704153600000,
                },
              };
            </script>
          </body>
        </html>`);
        return;
      }

      if (urlObj.pathname === '/@testuser/puppeteer-post-abc123def456') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html>
          <head>
            <meta property="og:title" content="Puppeteer Post">
            <meta property="og:url" content="${serverUrl}/@testuser/puppeteer-post-abc123def456">
          </head>
          <body>
            <script>
              window.__APOLLO_STATE__ = {
                'Post:abc123def456': {
                  id: 'abc123def456',
                  title: 'Puppeteer Post',
                  mediumUrl: '${serverUrl}/@testuser/puppeteer-post-abc123def456',
                  firstPublishedAt: 1704067200000,
                },
              };
            </script>
          </body>
        </html>`);
        return;
      }

      if (urlObj.pathname === '/p/abc123def456') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html>
          <head>
            <meta property="og:title" content="Puppeteer Post">
            <meta property="og:url" content="${serverUrl}/@testuser/puppeteer-post-abc123def456">
          </head>
          <body>
            <script>
              window.__APOLLO_STATE__ = {
                'Post:abc123def456': {
                  id: 'abc123def456',
                  title: 'Puppeteer Post',
                  mediumUrl: '${serverUrl}/@testuser/puppeteer-post-abc123def456',
                  firstPublishedAt: 1704067200000,
                },
              };
            </script>
          </body>
        </html>`);
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;

    client = new MediumClient({
      baseUrl: serverUrl,
      delayMin: 0,
      delayMax: 0,
    });
  }, 60000);

  afterAll(async () => {
    if (client) await client.close();
    if (server) server.close();
  }, 60000);

  it('fetches a user feed through the Puppeteer bridge', async () => {
    const result = await client.getUserFeed('testuser', { transport: 'puppeteer', limit: 5 });
    expect(result.items.length).toBe(2);
    expect(result.items[0].title).toBe('Second Puppeteer Post');
    expect(result.items[1].title).toBe('Puppeteer Post');
  }, 60000);

  it('fetches a single post through the Puppeteer bridge', async () => {
    const result = await client.getPost('abc123def456', { transport: 'puppeteer' });
    expect(result.title).toBe('Puppeteer Post');
    expect(result.id).toBe('abc123def456');
  }, 60000);
});
