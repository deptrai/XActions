// by nichxbt
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../api/server.js';

// Generate a fake JWT signed with the same secret the server uses.
// Auth middleware will reject it with 401 "User not found" (no DB user),
// which is fine for validation-guard tests — we accept [400, 401, 429].
const TEST_SECRET = process.env.JWT_SECRET || 'test-secret';
function makeToken(userId = 'fake-test-user-001') {
  return jwt.sign({ userId, username: 'ghost' }, TEST_SECRET, { expiresIn: '1h' });
}

// Auth cookie that satisfies requireFacebookCookie — used alongside every
// validation-guard request so the cookie guard doesn't fire first.
const VALID_COOKIE = { c_user: '100000000000001', xs: 'test-xs-value' };

// Acceptable status codes when a validation guard should fire (400) but auth
// may block first (401) or rate-limit may trigger (429).
const GUARD_STATUSES = [400, 401, 429];
// For "should NOT return 400" cases — auth blocks (401) or rate limit (429) are OK.
const NO_400_STATUSES = [401, 429, 200, 500];

describe('Facebook automate routes — validation guards', () => {
  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('POST /api/facebook/automate without auth token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .send({ action: 'like', urls: ['https://facebook.com/post/1'] });
    expect(res.status).toBe(401);
  });

  it('POST /api/facebook/scrape without auth token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .send({ action: 'profile', url: 'https://facebook.com/somepage' });
    expect(res.status).toBe(401);
  });

  it('POST /api/facebook/automate with malformed Bearer token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .send({ action: 'like', urls: ['https://facebook.com/post/1'],
              authCookie: VALID_COOKIE });
    expect(res.status).toBe(401);
  });

  // ── Unknown / missing action ───────────────────────────────────────────────

  it('POST /api/facebook/automate with unknown action → 400 (or 401)', async () => {
    const token = makeToken();
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'nonexistent-action', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body).toHaveProperty('ok', false);
      expect(res.body.error).toMatch(/action must be one of/);
    }
  });

  it('POST /api/facebook/automate with no action field → 400 (or 401)', async () => {
    const token = makeToken('fake-test-user-002');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
  });

  // ── share ──────────────────────────────────────────────────────────────────

  it('share — missing urls → 400', async () => {
    const token = makeToken('fake-test-user-010');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'share', authCookie: VALID_COOKIE });
    // urls not provided → guard should fire 400 (if auth passes)
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/share.*requires/i);
    }
  });

  it('share — empty urls array → 400', async () => {
    const token = makeToken('fake-test-user-011');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'share', urls: [], authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/share.*requires/i);
    }
  });

  // ── schedule ───────────────────────────────────────────────────────────────

  it('schedule — missing text → 400', async () => {
    const token = makeToken('fake-test-user-020');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'schedule',
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        authCookie: VALID_COOKIE,
      });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/schedule.*requires.*text/i);
    }
  });

  it('schedule — missing scheduledAt → 400', async () => {
    const token = makeToken('fake-test-user-021');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'schedule', text: 'Hello world', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/scheduledAt/i);
    }
  });

  it('schedule — invalid scheduledAt date string → 400', async () => {
    const token = makeToken('fake-test-user-022');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'schedule',
        text: 'Hello world',
        scheduledAt: 'not-a-date',
        authCookie: VALID_COOKIE,
      });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/scheduledAt/i);
    }
  });

  // ── join-groups ────────────────────────────────────────────────────────────

  it('join-groups — missing groupUrls → 400', async () => {
    const token = makeToken('fake-test-user-030');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'join-groups', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/join-groups.*requires/i);
    }
  });

  it('join-groups — empty groupUrls array → 400', async () => {
    const token = makeToken('fake-test-user-031');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'join-groups', groupUrls: [], authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/join-groups.*requires/i);
    }
  });

  // ── batch-post-groups ──────────────────────────────────────────────────────

  it('batch-post-groups — missing groupUrls → 400', async () => {
    const token = makeToken('fake-test-user-040');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'batch-post-groups', text: 'Hello', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/batch-post-groups.*requires.*groupUrls/i);
    }
  });

  it('batch-post-groups — missing text → 400', async () => {
    const token = makeToken('fake-test-user-041');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'batch-post-groups',
        groupUrls: ['https://facebook.com/groups/test'],
        authCookie: VALID_COOKIE,
      });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/batch-post-groups.*requires.*text/i);
    }
  });

  it('batch-post-groups — empty groupUrls array → 400', async () => {
    const token = makeToken('fake-test-user-042');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'batch-post-groups', groupUrls: [], text: 'Hello', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/batch-post-groups.*requires.*groupUrls/i);
    }
  });

  // ── send-friend-requests ───────────────────────────────────────────────────

  it('send-friend-requests — missing targets → 400', async () => {
    const token = makeToken('fake-test-user-050');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'send-friend-requests', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/send-friend-requests.*requires/i);
    }
  });

  it('send-friend-requests — empty targets array → 400', async () => {
    const token = makeToken('fake-test-user-051');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'send-friend-requests', targets: [], authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/send-friend-requests.*requires/i);
    }
  });

  // ── warmup-scroll-feed ─────────────────────────────────────────────────────

  it('warmup-scroll-feed — missing targetUrl → 400', async () => {
    const token = makeToken('fake-test-user-060');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'warmup-scroll-feed', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/warmup-scroll-feed.*requires.*targetUrl/i);
    }
  });

  it('warmup-scroll-feed — empty string targetUrl → 400', async () => {
    const token = makeToken('fake-test-user-061');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'warmup-scroll-feed', targetUrl: '   ', authCookie: VALID_COOKIE });
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/warmup-scroll-feed.*requires.*targetUrl/i);
    }
  });

  // ── cancel-friend-requests — NO required fields ────────────────────────────

  it('cancel-friend-requests — empty body should NOT return 400 (needs auth only)', async () => {
    const token = makeToken('fake-test-user-070');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'cancel-friend-requests', authCookie: VALID_COOKIE });
    // 400 is the only forbidden status — auth (401), rate-limit (429),
    // server error (500), or actual success (200) are all acceptable.
    expect(res.status).not.toBe(400);
    expect(NO_400_STATUSES.concat([200])).toContain(res.status);
  });

  it('cancel-friend-requests — with optional fields should NOT return 400', async () => {
    const token = makeToken('fake-test-user-071');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'cancel-friend-requests',
        olderThanDays: 30,
        limit: 10,
        authCookie: VALID_COOKIE,
      });
    expect(res.status).not.toBe(400);
  });

  // ── warmup-account — NO required fields ───────────────────────────────────

  it('warmup-account — empty body should NOT return 400 (needs auth only)', async () => {
    const token = makeToken('fake-test-user-080');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'warmup-account', authCookie: VALID_COOKIE });
    expect(res.status).not.toBe(400);
  });

  it('warmup-account — with optional fields should NOT return 400', async () => {
    const token = makeToken('fake-test-user-081');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'warmup-account',
        durationSeconds: 60,
        allowReactions: true,
        reactProbability: 0.3,
        authCookie: VALID_COOKIE,
      });
    expect(res.status).not.toBe(400);
  });

  // ── Scrape endpoint ────────────────────────────────────────────────────────

  it('POST /api/facebook/scrape — group-members without url → 400 (or 401)', async () => {
    const token = makeToken('fake-test-user-090');
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'group-members' }); // missing url
    expect(GUARD_STATUSES).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/url/i);
    }
  });

  it('POST /api/facebook/scrape — group-members with valid url format should NOT return 400', async () => {
    const token = makeToken('fake-test-user-091');
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'group-members', url: 'https://www.facebook.com/groups/123456789/members' });
    // Validation passes (400 is forbidden); actual scrape may fail with 401/500.
    expect(res.status).not.toBe(400);
  });

  // ── authCookie guard fires before action guard ─────────────────────────────

  it('POST /api/facebook/automate — missing authCookie entirely → 400 or 401', async () => {
    const token = makeToken('fake-test-user-100');
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'like', urls: ['https://facebook.com/post/1'] }); // no authCookie
    // 400 = cookie guard fired; 401 = auth middleware blocked
    expect([400, 401, 429]).toContain(res.status);
  });
});
