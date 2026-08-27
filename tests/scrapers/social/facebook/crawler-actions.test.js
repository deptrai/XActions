// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { FacebookActions } from '../../../../src/scrapers/social/facebook/actions.js';
import { FacebookActionVelocityTracker, runGuardedActionBatch } from '../../../../src/scrapers/social/facebook/batch-runner.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)
 * Acceptance Tests (ATDD Red Phase)
 */

describe('Story 13.9 — Facebook Hybrid Social Actions (Write & Messenger)', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  let sessionManager;
  let proxyPool;
  let governor;
  let accountPool;

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool, defaultRps: 100, maxRps: 100 });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('acc_fb_write_1', {
      accountId: 'acc_fb_write_1',
      platform: 'facebook',
      cookies: { c_user: '61590064244856', xs: 'sec_xs_write_123' },
    });
    accountPool.registerAccounts('facebook', ['acc_fb_write_1']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_WriteLsd123" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>
                requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_write_456"; });
                window.__spin_r = 1016839210;
                window.__spin_t = 1787681000;
                window.__hsi = "hsi_123";
              </script>
            </body></html>
          `);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { success: true } }));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('[AC-1] should register all write actions in FacebookCrawler ActionRegistry with requiresAuth: true', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toEqual(
      expect.arrayContaining([
        'like',
        'comment',
        'post',
        'share',
        'messenger_share',
        'share_link_uid',
        'join_group',
        'send_friend_request',
      ])
    );

    const writeActions = ['like', 'comment', 'post', 'share', 'messenger_share', 'share_link_uid', 'join_group', 'send_friend_request'];
    for (const name of writeActions) {
      const act = actions.find((a) => a.action === name);
      expect(act).toBeDefined();
      expect(act?.requiresAuth).toBe(true);
    }
  });

  it('[AC-2 & AC-10] should track action velocity with sliding window and reject when limits exceeded', async () => {
    const tracker = new FacebookActionVelocityTracker();
    const accountId = 'acc_fb_write_1';

    // Test like limit: <= 30/hr
    for (let i = 0; i < 30; i++) {
      expect(tracker.canExecute(accountId, 'like')).toBe(true);
      tracker.record(accountId, 'like');
    }
    expect(tracker.canExecute(accountId, 'like')).toBe(false);

    // Test comment limit: <= 10/hr
    for (let i = 0; i < 10; i++) {
      expect(tracker.canExecute(accountId, 'comment')).toBe(true);
      tracker.record(accountId, 'comment');
    }
    expect(tracker.canExecute(accountId, 'comment')).toBe(false);

    // Test post limit: <= 5/hr
    for (let i = 0; i < 5; i++) {
      expect(tracker.canExecute(accountId, 'post')).toBe(true);
      tracker.record(accountId, 'post');
    }
    expect(tracker.canExecute(accountId, 'post')).toBe(false);

    // Test friend request limit: <= 20/day
    for (let i = 0; i < 20; i++) {
      expect(tracker.canExecute(accountId, 'send_friend_request')).toBe(true);
      tracker.record(accountId, 'send_friend_request');
    }
    expect(tracker.canExecute(accountId, 'send_friend_request')).toBe(false);
  });

  it('[AC-2 & AC-10] should check governor per item in runGuardedActionBatch and enforce delay', async () => {
    const items = ['item_1', 'item_2', 'item_3'];
    let governorChecks = 0;

    const mockGov = {
      canAccountRequest: () => {
        governorChecks++;
        return true;
      },
      recordRequest: () => {},
    };

    const results = await runGuardedActionBatch(
      items,
      async (item) => ({ item, ok: true }),
      {
        actionName: 'like',
        accountId: 'acc_fb_write_1',
        governor: mockGov,
        delayMin: 10,
        delayMax: 20,
        dryRun: false,
      }
    );

    expect(results).toHaveLength(3);
    expect(governorChecks).toBe(3);
  });

  it('[AC-3 & AC-10] should support like action with dryRun default and reject non-Facebook URLs', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    // Reject non-Facebook URL
    await expect(
      crawler.start({
        action: 'like',
        args: { postUrl: 'https://evil.com/fake-post' },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    // Dry-run default
    const res = await crawler.start({
      action: 'like',
      args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502' },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res).toBeDefined();
    expect(res.dryRun).toBe(true);
    expect(res.results).toBeDefined();
    expect(res.results[0].postUrl).toContain('facebook.com');
  });

  it('[AC-4] should support comment action, reject empty or oversized text, and default dryRun', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    // Reject empty text
    await expect(
      crawler.start({
        action: 'comment',
        args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', text: '' },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    // Reject oversized text > 8000 chars
    await expect(
      crawler.start({
        action: 'comment',
        args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', text: 'a'.repeat(8001) },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    // Dry-run default
    const res = await crawler.start({
      action: 'comment',
      args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', text: 'Great update!' },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].postUrl).toBeDefined();
  });

  it('[AC-5] should support post action on profile timeline and groups with dryRun default', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    // Dry-run timeline post
    const res = await crawler.start({
      action: 'post',
      args: { text: 'Hello Facebook from XActions Hybrid Crawler!' },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toBeDefined();

    // Group post with invalid group URL
    await expect(
      crawler.start({
        action: 'post',
        args: { text: 'Group post', groupUrls: ['https://invalid-site.com/xyz'] },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);
  });

  it('[AC-6] should support share action on timeline with dryRun default', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    const res = await crawler.start({
      action: 'share',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        message: 'Must read!',
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].postUrl).toContain('facebook.com');
  });

  it('[AC-7] should support messenger_share and share_link_uid alias with dryRun default', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    // messenger_share with multiple recipients
    const res = await crawler.start({
      action: 'messenger_share',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        recipientUids: ['100001234567890', '100009876543210'],
        message: 'Check this out!',
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(2);
    expect(res.results[0].recipientUid).toBe('100001234567890');

    // share_link_uid alias
    const aliasRes = await crawler.start({
      action: 'share_link_uid',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        recipientUid: '100001234567890',
        message: 'Direct link share',
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(aliasRes.dryRun).toBe(true);
    expect(aliasRes.results).toHaveLength(1);
    expect(aliasRes.results[0].recipientUid).toBe('100001234567890');
  });

  it('[AC-8] should support join_group action and reject non-group URLs', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    await expect(
      crawler.start({
        action: 'join_group',
        args: { groupUrls: ['https://www.facebook.com/not-a-group/xyz'] },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    const res = await crawler.start({
      action: 'join_group',
      args: { groupUrls: ['https://www.facebook.com/groups/123456789'] },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(1);
  });

  it('[AC-9] should support send_friend_request action and validate targets', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager, governor, accountPool });

    // Invalid target
    await expect(
      crawler.start({
        action: 'send_friend_request',
        args: { targets: ['not-a-valid-target-format!@#'] },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    // Valid target
    const res = await crawler.start({
      action: 'send_friend_request',
      args: { targets: ['https://www.facebook.com/zuck', '100001234567890'] },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(2);
  });

  it('[AC-11] should require auth session and return PlatformError for missing account', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client });

    await expect(
      crawler.start({
        action: 'like',
        args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502' },
      })
    ).rejects.toThrow(PlatformError);
  });

  it('[AC-12] should mark legacy Facebook write scrapers as deprecated with JSDoc annotations', () => {
    const legacyFiles = [
      'src/scrapers/facebook/messengerShare.js',
      'src/scrapers/facebook/shareLinkByUid.js',
      'src/scrapers/facebook/graphqlSend.js',
    ];

    for (const relPath of legacyFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).toContain('@deprecated');
    }
  });
});
