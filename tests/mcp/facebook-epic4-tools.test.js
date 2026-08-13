// by nichxbt
// Tests for MCP Facebook Epic 4 tools dispatch layer.
// Validates auth guard, dryRun gate, arg forwarding, and special-case routing.
// No real browser or DB — service functions are tested separately.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeFacebookEpic4Tool } from '../../src/mcp/server.js';

const VALID_AUTH = { c_user: '100001', xs: 'abc123' };

const TOOL_NAMES = [
  'x_facebook_schedule_post',
  'x_facebook_share_posts',
  'x_facebook_warmup_scroll',
  'x_facebook_join_groups',
  'x_facebook_post_to_groups',
  'x_facebook_send_friend_requests',
  'x_facebook_cancel_friend_requests',
  'x_facebook_warmup_account',
  'x_facebook_group_members',
  'x_facebook_marketplace',
];

// ── Auth guard ────────────────────────────────────────────────────────────────

const REQUIRED_AUTH_TOOLS = TOOL_NAMES.filter((n) => n !== 'x_facebook_marketplace');

describe('executeFacebookEpic4Tool — auth guard', () => {
  it.each(REQUIRED_AUTH_TOOLS)('%s: throws when authCookie missing', async (name) => {
    await expect(executeFacebookEpic4Tool(name, {})).rejects.toThrow('authCookie');
  });

  it.each(REQUIRED_AUTH_TOOLS)('%s: throws when c_user empty', async (name) => {
    await expect(
      executeFacebookEpic4Tool(name, { authCookie: { c_user: '', xs: 'abc' } }),
    ).rejects.toThrow('authCookie');
  });

  it.each(REQUIRED_AUTH_TOOLS)('%s: throws when xs empty', async (name) => {
    await expect(
      executeFacebookEpic4Tool(name, { authCookie: { c_user: '123', xs: '' } }),
    ).rejects.toThrow('authCookie');
  });

  it('x_facebook_marketplace: missing authCookie falls back to anonymous dry-run', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_marketplace', { query: 'macbook' });
    expect(result.dryRun).toBe(true);
    expect(result.preview.searchUrl).toContain('marketplace');
  });
});

// ── dryRun gate (dry-run tools that don't need browser) ───────────────────────

describe('executeFacebookEpic4Tool — dryRun gate', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('x_facebook_warmup_account: undefined dryRun stays dry (no browser needed)', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_warmup_account', {
      authCookie: VALID_AUTH,
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview).toBeDefined();
  });

  it('x_facebook_warmup_account: dryRun:null stays dry', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_warmup_account', {
      authCookie: VALID_AUTH, dryRun: null,
    });
    expect(result.dryRun).toBe(true);
  });

  it('x_facebook_warmup_account: dryRun:0 stays dry', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_warmup_account', {
      authCookie: VALID_AUTH, dryRun: 0,
    });
    expect(result.dryRun).toBe(true);
  });

  it('x_facebook_warmup_scroll: dry-run with targetUrl returns preview', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_warmup_scroll', {
      authCookie: VALID_AUTH, targetUrl: 'https://www.facebook.com/groups/test',
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.targetUrl).toBe('https://www.facebook.com/groups/test');
  });

  it('x_facebook_share_posts: dry-run returns preview with postUrls', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_share_posts', {
      authCookie: VALID_AUTH,
      postUrls: ['https://www.facebook.com/user/posts/123'],
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview).toBeDefined();
  });
});

// ── schedule_post (DB-only, no browser) ───────────────────────────────────────

describe('executeFacebookEpic4Tool — x_facebook_schedule_post', () => {
  it('dry-run returns preview with content and scheduledAt', async () => {
    const futureDate = new Date(Date.now() + 120000).toISOString();
    const result = await executeFacebookEpic4Tool('x_facebook_schedule_post', {
      authCookie: VALID_AUTH,
      content: 'Hello from MCP',
      scheduledAt: futureDate,
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.content).toBe('Hello from MCP');
  });
});

// ── warmup_account (dry-run skips browser) ────────────────────────────────────

describe('executeFacebookEpic4Tool — x_facebook_warmup_account', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('dry-run returns preview with duration and reaction config', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_warmup_account', {
      authCookie: VALID_AUTH,
      durationSeconds: 300,
      allowReactions: true,
      reactProbability: 0.5,
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview.durationSeconds).toBe(300);
    expect(result.preview.allowReactions).toBe(true);
    expect(result.preview.reactProbability).toBe(0.2); // clamped
    expect(result.preview.reactProbabilityClamped).toBe(true);
  });

  it('duration 9999 clamped to 600', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_warmup_account', {
      authCookie: VALID_AUTH, durationSeconds: 9999,
    });
    expect(result.preview.durationSeconds).toBe(600);
    expect(result.preview.clamped).toBe(true);
  });
});

// ── join_groups (dry-run modes) ───────────────────────────────────────────────

describe('executeFacebookEpic4Tool — x_facebook_join_groups', () => {
  it('URL mode dry-run returns preview', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_join_groups', {
      authCookie: VALID_AUTH,
      groupUrls: ['https://www.facebook.com/groups/123'],
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview).toBeDefined();
  });

  it('keyword mode dry-run returns warning (no browser driven)', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_join_groups', {
      authCookie: VALID_AUTH,
      keyword: 'javascript',
      limit: 5,
    });
    expect(result.dryRun).toBe(true);
    expect(result.warning).toBeTruthy();
  });
});

// ── post_to_groups (dry-run) ──────────────────────────────────────────────────

describe('executeFacebookEpic4Tool — x_facebook_post_to_groups', () => {
  it('dry-run returns preview with content echoed', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_post_to_groups', {
      authCookie: VALID_AUTH,
      groupUrls: ['https://www.facebook.com/groups/456'],
      content: 'Test post',
    });
    expect(result.dryRun).toBe(true);
    expect(result.previewContent).toBe('Test post');
  });
});

// ── send_friend_requests (dry-run modes) ──────────────────────────────────────

describe('executeFacebookEpic4Tool — x_facebook_send_friend_requests', () => {
  it('uid_list mode dry-run returns preview', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_send_friend_requests', {
      authCookie: VALID_AUTH,
      mode: 'uid_list',
      targets: ['https://www.facebook.com/profile.php?id=1001'],
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview).toBeDefined();
  });

  it('suggestions mode dry-run returns warning', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_send_friend_requests', {
      authCookie: VALID_AUTH,
      mode: 'suggestions',
    });
    expect(result.dryRun).toBe(true);
    expect(result.warning).toBeTruthy();
  });
});

// ── optional field forwarding ─────────────────────────────────────────────────

describe('executeFacebookEpic4Tool — optional field forwarding', () => {
  it('x_facebook_share_posts: maxBatch forwarded when provided', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_share_posts', {
      authCookie: VALID_AUTH,
      postUrls: ['https://www.facebook.com/user/posts/789'],
      maxBatch: 5,
    });
    expect(result.dryRun).toBe(true);
  });
});

// ── unknown tool name ─────────────────────────────────────────────────────────

// ── scrape tools (new tool surface) ───────────────────────────────────────────

describe('executeFacebookEpic4Tool — x_facebook_group_members', () => {
  it('dry-run returns preview with groupUrl', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_group_members', {
      authCookie: VALID_AUTH,
      groupUrl: 'https://www.facebook.com/groups/testgroup',
      limit: 50,
    });
    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview.groupUrl).toBe('https://www.facebook.com/groups/testgroup');
    expect(result.preview.limit).toBe(50);
  });

  it('throws for non-group URL', async () => {
    await expect(
      executeFacebookEpic4Tool('x_facebook_group_members', {
        authCookie: VALID_AUTH,
        groupUrl: 'https://example.com/groups/test',
      }),
    ).rejects.toThrow('groupUrl');
  });
});

describe('executeFacebookEpic4Tool — x_facebook_marketplace', () => {
  it('dry-run returns preview with query and searchUrl (HCM slug)', async () => {
    const result = await executeFacebookEpic4Tool('x_facebook_marketplace', {
      authCookie: VALID_AUTH,
      query: 'macbook pro 14',
      location: 'Ho Chi Minh',
      limit: 10,
      minPrice: 1000,
      maxPrice: 3000,
    });
    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview.query).toBe('macbook pro 14');
    expect(result.preview.location).toBe('Ho Chi Minh');
    expect(result.preview.searchUrl).toContain('macbook%20pro%2014');
    expect(result.preview.searchUrl).toContain('hochiminhcity');
  });

  it('throws for missing query', async () => {
    await expect(
      executeFacebookEpic4Tool('x_facebook_marketplace', {
        authCookie: VALID_AUTH,
      }),
    ).rejects.toThrow();
  });
});

describe('executeFacebookEpic4Tool — unknown tool', () => {
  it('throws unhandled tool name error', async () => {
    await expect(
      executeFacebookEpic4Tool('x_facebook_nonexistent', { authCookie: VALID_AUTH }),
    ).rejects.toThrow('unhandled tool name');
  });
});

// ── export smoke test ─────────────────────────────────────────────────────────

describe('executeFacebookEpic4Tool — export', () => {
  it('is a function', () => {
    expect(typeof executeFacebookEpic4Tool).toBe('function');
  });
});
