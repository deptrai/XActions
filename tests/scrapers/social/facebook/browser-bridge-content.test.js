// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { FacebookBrowserBridge } from '../../../../src/scrapers/social/facebook/signer-bridge.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { GotJsdomAdapter } from '../../../../src/scrapers/adapters/got-jsdom.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

describe('Story 13.5 — FacebookBrowserBridge content fallback', () => {
  let server;
  let serverUrl;
  const createStore = () => new PrismaStore({ prisma });

  const profileHtml = (name, username, userId) => `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${name} | Facebook</title>
        <meta property="og:title" content="${name} | Facebook">
        <meta property="og:description" content="12.5K followers. Building the metaverse and open source AI.">
        <meta property="og:image" content="https://cdn.fb.com/${username || userId}.jpg">
      </head>
      <body>
        <div role="main">
          <h1>${name}</h1>
          <p>Building the metaverse and open source AI.</p>
          <p>12.5K followers</p>
        </div>
      </body>
    </html>
  `;

  const membersHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <div>
          <a href="/groups/123456/user/5001/">Dev Lead One</a>
          <a href="/groups/123456/user/5002/">Frontend Junior</a>
          <a href="/groups/123456/user/5003/">React Veteran</a>
        </div>
      </body>
    </html>
  `;

  const restrictedGroupHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <p>This content isn't available right now.</p>
      </body>
    </html>
  `;

  const homeHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Facebook</title></head>
      <body>
        <input type="hidden" name="jazoest" value="2953" />
        <input type="hidden" name="lsd" value="AVq_BridgeFallback123" />
        <script>
          requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_BridgeFallback"; });
          window.__spin_r = 1016839210;
          window.__spin_t = 1787680000;
          window.__hsi = "739281928371928";
          window.__rev = "123456789";
          window.Env = { "USER_ID" : "10001" };
        </script>
      </body>
    </html>
  `;

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(homeHtml);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
          return;
        }

        if (req.url?.startsWith('/zuck')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(profileHtml('Mark Zuckerberg', 'zuck', '4'));
          return;
        }

        if (req.url?.startsWith('/profile.php')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(profileHtml('Numeric Test User', 'numeric_user', '4'));
          return;
        }

        if (req.url === '/groups/123456/members') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(membersHtml);
          return;
        }

        if (req.url === '/groups/restricted/members') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(restrictedGroupHtml);
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanupTestDatabase();
  });

  // ============================================================================
  // Bridge profile scraping
  // ============================================================================

  it('[P0] FacebookBrowserBridge.scrapeProfile should return a ProfileItem from mbasic-style HTML', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });

    const profile = await bridge.scrapeProfile('zuck', {
      baseUrl: serverUrl,
      cookies: 'c_user=10001; xs=sec_123',
      accountId: 'fb-user-1',
    });

    expect(profile).toBeDefined();
    expect(profile.id).toBe('facebook:zuck');
    expect(profile.externalId).toBe('zuck');
    expect(profile.username).toBe('zuck');
    expect(profile.name).toBe('Mark Zuckerberg');
    expect(profile.bio).toContain('metaverse');
    expect(profile.avatar).toBe('https://cdn.fb.com/zuck.jpg');
    expect(profile.followersCount).toBe(12500);
    expect(profile.platform).toBe('facebook');
    expect(profile.metadata?.sourceMethod).toBe('browser');

    await bridge.close();
  });

  it('[P0] FacebookBrowserBridge.scrapeProfile should support numeric id via profile.php', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });

    const profile = await bridge.scrapeProfile('4', {
      baseUrl: serverUrl,
      cookies: 'c_user=10001; xs=sec_123',
      accountId: 'fb-user-1',
    });

    expect(profile).toBeDefined();
    expect(profile.externalId).toBe('4');
    expect(profile.id).toBe('facebook:4');

    await bridge.close();
  });

  it('[P1] FacebookBrowserBridge.scrapeProfile should throw XACT_4004 when profile is not found', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });

    await expect(bridge.scrapeProfile('notfound', {
      baseUrl: serverUrl,
      cookies: 'c_user=10001; xs=sec_123',
      accountId: 'fb-user-1',
    })).rejects.toMatchObject({
      code: 'XACT_4004',
      suggestedAction: 'relogin',
    });

    await bridge.close();
  });

  // ============================================================================
  // Bridge group members scraping
  // ============================================================================

  it('[P0] FacebookBrowserBridge.scrapeGroupMembers should return ProfileItem[] from a group /members page', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });

    const result = await bridge.scrapeGroupMembers('123456', {
      baseUrl: serverUrl,
      cookies: 'c_user=10001; xs=sec_123',
      accountId: 'fb-user-1',
      limit: 10,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
    expect(result.members.length).toBe(3);

    const first = result.members[0];
    expect(first.id).toBe('facebook:5001');
    expect(first.externalId).toBe('5001');
    expect(first.name).toBe('Dev Lead One');
    expect(first.platform).toBe('facebook');
    expect(first.metadata?.isGroupMember).toBe(true);
    expect(first.metadata?.sourceMethod).toBe('browser');
    expect(first.metadata?.groupId).toBe('123456');

    await bridge.close();
  });

  it('[P0] FacebookBrowserBridge.scrapeGroupMembers should return an empty list + note for a restricted group', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });

    const result = await bridge.scrapeGroupMembers('restricted', {
      baseUrl: serverUrl,
      cookies: 'c_user=10001; xs=sec_123',
      accountId: 'fb-user-1',
      limit: 10,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
    expect(result.members.length).toBe(0);
    expect(result.note).toContain('restricted');

    await bridge.close();
  });

  // ============================================================================
  // Crawler integration: GraphQL empty -> browser fallback
  // ============================================================================

  it('[P0] FacebookCrawler.profile should fall back to the browser bridge when GraphQL returns no profile', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });
    const client = new FacebookClient({
      baseUrl: serverUrl,
      browserBridge: bridge,
      httpFallback: true,
    });
    const crawler = new FacebookCrawler({
      client,
      docIds: { PROFILE: 'fb_profile_fallback_doc' },
      store: createStore(),
    });

    const result = await crawler.profile({ username: 'zuck' }, { accountId: 'fb-user-1' });

    expect(result).toBeDefined();
    expect(result.profile).toBeDefined();
    expect(result.profile.id).toBe('facebook:zuck');
    expect(result.profile.name).toBe('Mark Zuckerberg');
    expect(result.profile.followersCount).toBe(12500);
    expect(result.profile.metadata?.sourceMethod).toBe('browser');

    await client.close();
    await crawler.cleanup();
  });

  it('[P0] FacebookCrawler.groupMembers should fall back to the browser bridge when GraphQL returns no group', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });
    const client = new FacebookClient({
      baseUrl: serverUrl,
      browserBridge: bridge,
      httpFallback: true,
    });
    const crawler = new FacebookCrawler({
      client,
      docIds: { GROUP_MEMBERS: 'fb_group_fallback_doc' },
      store: createStore(),
    });

    const result = await crawler.groupMembers({ groupUrl: 'https://www.facebook.com/groups/123456', limit: 10 }, { accountId: 'fb-user-1' });

    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
    expect(result.members.length).toBe(3);
    expect(result.members[0].id).toBe('facebook:5001');
    expect(result.members[0].metadata?.sourceMethod).toBe('browser');

    await client.close();
    await crawler.cleanup();
  });

  it('[P0] FacebookCrawler.groupMembers should return a note for a restricted group via browser fallback', async () => {
    const adapter = new GotJsdomAdapter();
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter,
    });
    const client = new FacebookClient({
      baseUrl: serverUrl,
      browserBridge: bridge,
      httpFallback: true,
    });
    const crawler = new FacebookCrawler({
      client,
      docIds: { GROUP_MEMBERS: 'fb_group_fallback_doc' },
      store: createStore(),
    });

    const result = await crawler.groupMembers({ groupUrl: 'https://www.facebook.com/groups/restricted', limit: 10 }, { accountId: 'fb-user-1' });

    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
    expect(result.members.length).toBe(0);
    expect(result.note).toContain('restricted');

    await client.close();
    await crawler.cleanup();
  });
});
