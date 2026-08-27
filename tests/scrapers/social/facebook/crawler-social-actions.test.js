// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { FacebookActions } from '../../../../src/scrapers/social/facebook/actions.js';
import { FacebookActionVelocityTracker, runGuardedActionBatch } from '../../../../src/scrapers/social/facebook/batch-runner.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { stripPii } from '../../../../src/scrapers/social/facebook/pii.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * In-memory page test-harness for the live path. It returns pre-canned DOM
 * evaluation results that exercise the write action code paths without
 * launching a real browser.
 */
class FakePage {
  constructor() {
    this.url = '';
    this.evaluateCount = 0;
    this.__actionName = '';
    this.keyboard = {
      press: async () => {},
      type: async () => {},
    };
  }

  async goto(url, _options = {}) {
    this.url = url;
    this.evaluateCount = 0;
    this.__actionName = '';
  }

  /**
   * Infer the current action from the evaluated function source so the
   * test harness does not depend on the removed `page.__actionName` seam.
   */
  #inferAction(_fn) {
    const source = typeof _fn === 'function' ? _fn.toString() : String(_fn || '');
    if (source.includes('likeSelectors') || source.includes('unlikeSelectors')) return 'like';
    if (source.includes('Write a public comment') || source.includes('Write a comment') || source.includes('Viết bình luận') || source.includes('/comment/')) return 'comment';
    if (source.includes('Tạo bài viết') || source.includes('Create post') || source.includes("What's on your mind?") || source.includes('Bạn đang nghĩ gì?') || source.includes('Viết gì đó...') || source.includes('Đăng')) return 'post';
    if (source.includes('data-ad-rendering-role="share_button"') || source.includes('share to your own timeline') || source.includes('share now') || source.includes('chia sẻ ngay')) return 'share';
    if (source.includes('Join Group') || source.includes('Tham gia nhóm') || source.includes('a[href*="/groups/"]')) return 'join_group';
    if (source.includes('Add Friend') || source.includes('Thêm bạn bè') || source.includes('Kết bạn')) return 'send_friend_request';
    if (source.includes('contenteditable="true"') || source.includes('[role="textbox"]')) return 'messenger_share';
    return '';
  }

  async evaluate(_fn, ..._args) {
    this.evaluateCount++;

    if (this.url.includes('/messages/t/')) {
      this.__actionName = 'messenger_share';
      return true;
    }
    if (this.url.includes('/search/groups/')) {
      return this.evaluateCount === 1
        ? ['https://www.facebook.com/groups/111', 'https://www.facebook.com/groups/222']
        : undefined;
    }
    if (this.url.includes('/people/search')) {
      return this.evaluateCount === 1
        ? ['https://www.facebook.com/search-result-1', 'https://www.facebook.com/search-result-2']
        : undefined;
    }
    if (this.url.includes('/friends/suggestions')) {
      return this.evaluateCount <= 2 ? { found: true } : { found: false };
    }

    if (!this.__actionName) {
      this.__actionName = this.#inferAction(_fn);
    }
    const action = this.__actionName || 'unknown';
    const count = this.evaluateCount;

    if (action === 'like') {
      if (count === 1) return { found: true, alreadyLiked: false };
      return true;
    }
    if (action === 'comment' || action === 'group_comment') {
      if (count === 1) return '[role="textbox"][contenteditable="true"]';
      if (count === 2) return true;
      return 'comment_12345';
    }
    if (action === 'post' || action === 'group_post') {
      if (count === 1) return true;
      if (count === 2) return '[role="textbox"][contenteditable="true"]';
      if (count === 3) return true;
      if (count === 4) return true;
      if (count === 5) return null;
      return 'post_12345';
    }
    if (action === 'share') {
      if (count === 1) return { ok: true };
      return true;
    }
    if (action === 'messenger_share') {
      if (count === 1) return true;
      if (count === 2) return true;
      return true;
    }
    if (action === 'join_group') {
      if (count === 1) return { found: true, label: 'Join Group' };
      return true;
    }
    if (action === 'send_friend_request') {
      if (count === 1) return { found: true };
      return true;
    }

    return true;
  }
}

/**
 * In-memory browser bridge for the live path tests.
 */
class FakeFacebookBrowserBridge {
  withPageCalls = [];

  async withPage(fn, options = {}) {
    this.withPageCalls.push(options);
    const page = new FakePage();
    return fn(page);
  }

  async evaluateDom(fn, options = {}) {
    return this.withPage(fn, options);
  }

  async extractTokens(_accountId, cookies) {
    const cUser =
      typeof cookies === 'string'
        ? (cookies.match(/c_user=([^;]+)/)?.[1] || '0')
        : (cookies?.c_user || '0');
    return {
      lsd: 'test_lsd',
      dtsg: 'test_dtsg',
      jazoest: '2953',
      c_user: cUser,
      spin_r: 1016839210,
      spin_t: Math.floor(Date.now() / 1000),
      hsi: 'test_hsi',
      __dyn: '',
      __csr: '',
      __hs: '',
      __hsdp: '',
      __hblp: '',
      __s: '',
      dpr: '1',
      x_fb_lsd: 'test_lsd',
      fb_api_req_friendly_name: '',
    };
  }
}

describe('Story 13.9 — Facebook Hybrid Social Actions (Write & Messenger)', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  let sessionManager;
  let governor;
  let accountPool;

  beforeAll(async () => {
    const proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool });
    governor.setPlatformLimit('facebook', { safeRequestsPerMinute: 10_000 });
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
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id') || '';

          if (docId.startsWith('bad_') || docId === 'rotated_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ code: 5000, message: 'Invalid doc_id' }] }));
            return;
          }

          if (docId === 'rate_limited_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ code: 368, message: 'Rate limit' }] }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { success: true, doc_id: docId } }));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function makeClient() {
    const bridge = new FakeFacebookBrowserBridge();
    const client = new FacebookClient({ baseUrl: serverUrl, browserBridge: bridge });
    return { client, bridge };
  }

  function makeCrawler(client) {
    return new FacebookCrawler({ client, sessionManager, governor, accountPool });
  }

  it('[AC-1] should register all write actions with requiresAuth: true', () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);
    const expected = [
      'like',
      'comment',
      'post',
      'share',
      'messenger_share',
      'share_link_uid',
      'join_group',
      'send_friend_request',
    ];

    expect(actionNames).toEqual(expect.arrayContaining(expected));

    for (const name of expected) {
      const act = actions.find((a) => a.action === name);
      expect(act).toBeDefined();
      expect(act?.requiresAuth).toBe(true);
    }
  });

  it('[AC-2] should track action velocity with sliding window', () => {
    const tracker = new FacebookActionVelocityTracker();
    const accountId = 'acc_fb_write_1';

    for (let i = 0; i < 30; i++) {
      expect(tracker.canDoAction(accountId, 'like')).toBe(true);
      tracker.recordAction(accountId, 'like');
    }
    expect(tracker.canDoAction(accountId, 'like')).toBe(false);

    for (let i = 0; i < 10; i++) {
      expect(tracker.canDoAction(accountId, 'comment')).toBe(true);
      tracker.recordAction(accountId, 'comment');
    }
    expect(tracker.canDoAction(accountId, 'comment')).toBe(false);
  });

  it('[AC-3] should reject non-Facebook URLs and default to dry-run', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    await expect(
      crawler.start({
        action: 'like',
        args: { postUrl: 'https://evil.com/fake-post' },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    const res = await crawler.start({
      action: 'like',
      args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502' },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results[0].postUrl).toContain('facebook.com');
  });

  it('[AC-4] should reject invalid comment args and strip PII in preview', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    await expect(
      crawler.start({
        action: 'comment',
        args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', text: '' },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    const res = await crawler.start({
      action: 'comment',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        text: 'Great update! Call me at 0901234567 or email test@example.com',
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results[0].previewText).not.toContain('0901234567');
    expect(res.results[0].previewText).not.toContain('@');
  });

  it('[AC-5] should support post action dry-run on profile and group', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'post',
      args: {
        text: 'Hello Facebook from XActions Hybrid Crawler!',
        groupUrls: ['https://www.facebook.com/groups/123456'],
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].targetUrl).toContain('/groups/');

    const defaultRes = await crawler.start({
      action: 'post',
      args: { text: 'Hello timeline!' },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(defaultRes.dryRun).toBe(true);
    expect(defaultRes.results).toHaveLength(1);
    expect(defaultRes.results[0].targetUrl).toBe('https://www.facebook.com/me');

    await expect(
      crawler.start({
        action: 'post',
        args: { text: 'Group post', groupUrls: ['https://invalid-site.com/xyz'] },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);
  });

  it('[AC-6] should support share and messenger_share dry-run', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'share',
      args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', message: 'Must read!' },
      session: { accountId: 'acc_fb_write_1' },
    });
    expect(res.dryRun).toBe(true);
    expect(res.results[0].shared).toBe(false);

    const messengerRes = await crawler.start({
      action: 'messenger_share',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        recipientUids: ['100001234567890', '100009876543210'],
        message: 'Check this out!',
      },
      session: { accountId: 'acc_fb_write_1' },
    });
    expect(messengerRes.dryRun).toBe(true);
    expect(messengerRes.results).toHaveLength(2);
    expect(messengerRes.results[0].recipientUid).toBe('100001234567890');
  });

  it('[AC-6b] share_link_uid alias returns a single result object', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    const aliasRes = await crawler.start({
      action: 'share_link_uid',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        recipientUid: '100001234567890',
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(aliasRes.dryRun).toBe(true);
    expect(aliasRes.ok).toBe(false);
    expect(aliasRes.recipientUid).toBe('100001234567890');
    expect(Array.isArray(aliasRes.results)).toBe(false);
  });

  it('[AC-7] should support join_group and send_friend_request dry-run', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    await expect(
      crawler.start({
        action: 'join_group',
        args: { groupUrls: ['https://www.facebook.com/not-a-group/xyz'] },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    const joinRes = await crawler.start({
      action: 'join_group',
      args: { groupUrls: ['https://www.facebook.com/groups/123456789'] },
      session: { accountId: 'acc_fb_write_1' },
    });
    expect(joinRes.dryRun).toBe(true);
    expect(joinRes.results[0].joined).toBe(false);

    await expect(
      crawler.start({
        action: 'send_friend_request',
        args: { targets: ['not-a-valid-target!@#'] },
        session: { accountId: 'acc_fb_write_1' },
      })
    ).rejects.toThrow(PlatformError);

    const friendRes = await crawler.start({
      action: 'send_friend_request',
      args: { targets: ['https://www.facebook.com/zuck', '100001234567890'] },
      session: { accountId: 'acc_fb_write_1' },
    });
    expect(friendRes.dryRun).toBe(true);
    expect(friendRes.results).toHaveLength(2);
  });

  it('[AC-8] should throw XACT_4010 for missing account', async () => {
    const { client } = makeClient();
    const noPoolCrawler = new FacebookCrawler({ client, sessionManager, governor });

    await expect(
      noPoolCrawler.start({
        action: 'like',
        args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502' },
      })
    ).rejects.toMatchObject({ code: 'XACT_4010' });
  });

  it('[AC-9] live like through fake bridge with residential flag', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'like',
      args: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', dryRun: false },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results[0].liked).toBe(true);
    expect(bridge.withPageCalls.length).toBe(1);
    expect(bridge.withPageCalls[0].requiresResidential).toBe(true);
    expect(bridge.withPageCalls[0].accountId).toBe('acc_fb_write_1');
  });

  it('[AC-10] live comment through fake bridge', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'comment',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        text: 'Nice post!',
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results[0].commented).toBe(true);
    expect(bridge.withPageCalls.length).toBe(1);
  });

  it('[AC-11] live post to profile and group through fake bridge', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'post',
      args: {
        text: 'Hybrid post test',
        profileUrls: ['https://www.facebook.com/me'],
        groupUrls: ['https://www.facebook.com/groups/hybrid-test'],
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results).toHaveLength(2);
    expect(res.results[0].posted).toBe(true);
    expect(res.results[0].postId).toBe('post_12345');
    expect(res.results[1].posted).toBe(true);
    expect(bridge.withPageCalls.length).toBe(2);
  });

  it('[AC-12] live share through fake bridge', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'share',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        message: 'Must read!',
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results[0].shared).toBe(true);
    expect(bridge.withPageCalls.length).toBe(1);
  });

  it('[AC-13] live messenger_share and share_link_uid through fake bridge', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'messenger_share',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        recipientUids: ['100001234567890'],
        message: 'Check this out!',
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[0].method).toBe('direct-messenger-url');
    expect(bridge.withPageCalls.length).toBe(1);

    const aliasRes = await crawler.start({
      action: 'share_link_uid',
      args: {
        postUrl: 'https://www.facebook.com/zuck/posts/1011565502',
        recipientUid: '100001234567890',
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(aliasRes.dryRun).toBe(false);
    expect(aliasRes.ok).toBe(true);
    expect(aliasRes.recipientUid).toBe('100001234567890');
  });

  it('[AC-14] live join_group and send_friend_request through fake bridge', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const joinRes = await crawler.start({
      action: 'join_group',
      args: {
        groupUrls: ['https://www.facebook.com/groups/123456'],
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(joinRes.dryRun).toBe(false);
    expect(joinRes.results[0].joined).toBe(true);
    expect(joinRes.results[0].pending).toBe(true);

    const friendRes = await crawler.start({
      action: 'send_friend_request',
      args: {
        targets: ['https://www.facebook.com/zuck'],
        dryRun: false,
      },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(friendRes.dryRun).toBe(false);
    expect(friendRes.results[0].ok).toBe(true);
    expect(bridge.withPageCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('[AC-15] should use keyword search in join_group live path', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'join_group',
      args: { keyword: 'marketing', limit: 1, dryRun: false },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].joined).toBe(true);
    expect(bridge.withPageCalls.length).toBe(1);
  });

  it('[AC-16] should use location search in send_friend_request live path', async () => {
    const { client, bridge } = makeClient();
    const crawler = makeCrawler(client);

    const res = await crawler.start({
      action: 'send_friend_request',
      args: { mode: 'location', location: 'Hanoi', limit: 1, dryRun: false },
      session: { accountId: 'acc_fb_write_1' },
    });

    expect(res.dryRun).toBe(false);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].ok).toBe(true);
    expect(bridge.withPageCalls.length).toBe(1);
  });

  it('[AC-17] public resolvePostFeedbackContext handles numeric and URL inputs', async () => {
    const { client } = makeClient();
    const crawler = makeCrawler(client);

    const byId = await crawler.resolvePostFeedbackContext('123456789', '');
    expect(byId).toBeDefined();
    expect(byId?.feedbackId).toBeDefined();

    const byUrl = await crawler.resolvePostFeedbackContext(
      'https://www.facebook.com/zuck/posts/1011565502',
      '',
      'acc_fb_write_1'
    );
    expect(byUrl).toBeDefined();
    expect(byUrl?.feedbackId).toBeDefined();
  });

  it('[AC-18] client GraphQL body includes anti-bot tokens', () => {
    const { client } = makeClient();
    const body = client.buildGraphQlBody('doc_1', { input: 'x' }, {
      lsd: 'lsd',
      dtsg: 'dtsg',
      jazoest: '2953',
      c_user: '123',
      __dyn: 'dyn',
      __csr: 'csr',
      __hs: 'hs',
      __hsdp: 'hsdp',
      __hblp: 'hblp',
      __s: 's',
      dpr: '2',
      x_fb_lsd: 'x_lsd',
      fb_api_req_friendly_name: 'MyMutation',
    });

    expect(body).toContain('doc_id=doc_1');
    expect(body).toContain('__dyn=dyn');
    expect(body).toContain('__csr=csr');
    expect(body).toContain('__hs=hs');
    expect(body).toContain('__hsdp=hsdp');
    expect(body).toContain('__hblp=hblp');
    expect(body).toContain('__s=s');
    expect(body).toContain('dpr=2');
    expect(body).toContain('x_fb_lsd=x_lsd');
    expect(body).toContain('fb_api_req_friendly_name=MyMutation');
  });

  it('[AC-19] client requestGraphQl supports fallback doc_ids', async () => {
    const { client } = makeClient();

    const res = await client.requestGraphQl('bad_doc', { input: 'x' }, {
      accountId: 'acc_fb_write_1',
      cookies: { c_user: '61590064244856' },
      requiresAuth: true,
      fallbackDocIds: ['good_doc'],
    });

    expect(res.data.success).toBe(true);
    expect(res.data.doc_id).toBe('good_doc');
  });

  it('[AC-20] client requestGraphQl surfaces upstream rate limit as XACT_4290', async () => {
    const { client } = makeClient();

    await expect(
      client.requestGraphQl('rate_limited_doc', { input: 'x' }, {
        accountId: 'acc_fb_write_1',
        cookies: { c_user: '61590064244856' },
        requiresAuth: true,
      })
    ).rejects.toMatchObject({ code: 'XACT_4290' });
  });

  it('[AC-21] runGuardedActionBatch clamps delay floor and records governor', async () => {
    const start = Date.now();
    const items = ['a', 'b'];

    await runGuardedActionBatch(
      items,
      async (item) => ({ item, ok: true }),
      {
        actionName: 'like',
        accountId: 'acc_fb_write_1',
        governor,
        dryRun: false,
        delayMin: 0,
        delayMax: 0,
      }
    );

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(800);
    expect(governor.getAccountVelocity('acc_fb_write_1', 'facebook')).toBeGreaterThanOrEqual(2);
  });

  it('[AC-22] runGuardedActionBatch throws XACT_4291 when account hibernates', async () => {
    governor.hibernateAccount('acc_hibernate', 'rate_limit', 60_000, 'facebook');

    await expect(
      runGuardedActionBatch(
        ['a'],
        async (item) => ({ item, ok: true }),
        {
          actionName: 'like',
          accountId: 'acc_hibernate',
          governor,
          dryRun: false,
        }
      )
    ).rejects.toMatchObject({ code: 'XACT_4291' });
  });

  it('[AC-23] runGuardedActionBatch isolates per-item errors', async () => {
    const results = await runGuardedActionBatch(
      ['item1', 'item2', 'item3'],
      async (item, idx) => {
        if (idx === 1) throw new Error('Simulated network timeout');
        return { item, ok: true };
      },
      { actionName: 'like', accountId: 'acc_fb_write_1', dryRun: true }
    );

    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toContain('Simulated network timeout');
    expect(results[2].ok).toBe(true);
  });

  it('[AC-24] stripPii removes phone and email from text', () => {
    const raw = 'Contact 0901234567 or test@example.com for details';
    const cleaned = stripPii(raw);
    expect(cleaned).not.toContain('0901234567');
    expect(cleaned).not.toContain('@');
  });

  it('[AC-25] legacy write scrapers are marked deprecated', () => {
    const legacyFiles = [
      'src/scrapers/facebook/messengerShare.js',
      'src/scrapers/facebook/shareLinkByUid.js',
    ];

    for (const relPath of legacyFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).toContain('@deprecated');
    }
  });

  it('[AC-26] FacebookActions throws XACT_5030 when no bridge is available', async () => {
    const actions = new FacebookActions({ client: {} });

    await expect(
      actions.like({ postUrl: 'https://www.facebook.com/zuck/posts/1011565502', dryRun: false }, {
        accountId: 'acc_fb_write_1',
      })
    ).rejects.toMatchObject({ code: 'XACT_5030' });
  });
});
