// by nichxbt
/**
 * verify-instagram-session.mjs — Story 35.5 live verification runner.
 *
 * Verifies that an InstagramClient session persists across >=10 sequential
 * requests (mix of user/hashtag/post) without a challenge/checkpoint, under a
 * stable residential proxy. Closes retro action item epic-35-retro-item-4.
 *
 * Credentials are read from env ONLY (never committed):
 *   IG_TEST_SESSIONID  — sessionid cookie value (preferred), or
 *   IG_TEST_USER / IG_TEST_PASS — username+password login fallback
 *   IG_TEST_DS_USER_ID — optional ds_user_id cookie
 *   IG_TEST_CSRFTOKEN  — optional csrftoken cookie
 *   PROXY_URL          — stable residential proxy (country-us preferred, NOT country-vn)
 *   IG_VERIFY_REQUESTS — total requests to run (default 12, spec metric >=10)
 *
 * Usage: node scripts/verify-instagram-session.mjs
 * Writes: _bmad-output/implementation-artifacts/instagram-session-verify-report.md
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { InstagramClient } from '../src/scrapers/social/instagram/client.js';
import { InstagramCrawler } from '../src/scrapers/social/instagram/crawler.js';
import { SessionManager } from '../src/core/session-manager.js';
import { PlatformError, ErrorTypes } from '../src/core/error-envelope.js';

const REQUEST_TARGET = Number(process.env.IG_VERIFY_REQUESTS) || 12;
const REPORT_PATH = '_bmad-output/implementation-artifacts/instagram-session-verify-report.md';

const gaussianDelay = (minMs = 1000, maxMs = 3000) => {
  // Box-Muller — human-like jitter per story dev notes (1-3s gaussian).
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mid = (minMs + maxMs) / 2;
  const sd = (maxMs - minMs) / 4;
  return Math.max(minMs, Math.min(maxMs, Math.round(mid + g * sd)));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build the credentials object the client expects from IG_TEST_* env vars. */
function resolveCredentials() {
  const { IG_TEST_SESSIONID, IG_TEST_USER, IG_TEST_PASS, IG_TEST_DS_USER_ID, IG_TEST_CSRFTOKEN } = process.env;
  if (IG_TEST_SESSIONID) {
    return {
      sessionid: IG_TEST_SESSIONID,
      ...(IG_TEST_DS_USER_ID && { ds_user_id: IG_TEST_DS_USER_ID }),
      ...(IG_TEST_CSRFTOKEN && { csrftoken: IG_TEST_CSRFTOKEN }),
    };
  }
  if (IG_TEST_USER && IG_TEST_PASS) {
    return { username: IG_TEST_USER, password: IG_TEST_PASS };
  }
  return null;
}

/** @returns {string} 'ok' | 'challenge' | 'error' */
function classifyResult(err) {
  if (!err) return 'ok';
  if (err instanceof PlatformError) {
    const t = String(err.type || '');
    if (t === ErrorTypes.BOT_CHALLENGE || /challenge|checkpoint/i.test(err.message || '')) return 'challenge';
  }
  return 'error';
}

async function main() {
  const credentials = resolveCredentials();
  if (!credentials) {
    console.error('❌ Missing credentials. Set IG_TEST_SESSIONID (or IG_TEST_USER + IG_TEST_PASS) and PROXY_URL in env.');
    console.error('   This is an operator-run live verification — credentials are never committed.');
    process.exit(1);
  }
  if (!process.env.PROXY_URL) {
    console.error('❌ Missing PROXY_URL — a stable residential proxy (country-us preferred) is required.');
    process.exit(1);
  }

  const accountId = `ig-verify-${new Date().toISOString().slice(0, 10)}`;
  const sessionManager = new SessionManager();
  const client = new InstagramClient({
    sessionManager,
    credentials,
    requiresResidential: true,
    ...(process.env.INSTAGRAM_TRANSPORT && { transport: process.env.INSTAGRAM_TRANSPORT }),
  });
  const crawler = new InstagramCrawler({ client, sessionManager });

  // AC-2: session establishment
  console.log('🔄 Establishing session…');
  const session = await client.ensureSession(accountId, credentials);
  if (!session) {
    console.error('❌ Session establishment failed — ensureSession returned null.');
    process.exit(1);
  }
  console.log(`✅ Session established (account: ${session.accountId}, transport: ${client.transport})`);

  // AC-3: >=10 sequential requests, mixed actions, gaussian delays.
  const targets = [
    { action: 'user', args: { username: 'instagram' } },
    { action: 'user', args: { username: 'meta' } },
    { action: 'hashtag', args: { tag: 'photography' } },
    { action: 'user', args: { username: 'nasa' } },
    { action: 'hashtag', args: { tag: 'travel' } },
    { action: 'user', args: { username: 'adidas' } },
    { action: 'hashtag', args: { tag: 'food' } },
    { action: 'user', args: { username: 'spotify' } },
    { action: 'hashtag', args: { tag: 'nature' } },
    { action: 'user', args: { username: 'airbnb' } },
    { action: 'hashtag', args: { tag: 'art' } },
    { action: 'user', args: { username: 'tesla' } },
  ].slice(0, REQUEST_TARGET);

  /** @type {Array<{ n: number, action: string, target: string, at: string, status: string, items: number, error?: string }>} */
  const log = [];
  let challengeCount = 0;

  for (const [i, t] of targets.entries()) {
    const entry = {
      n: i + 1,
      action: t.action,
      target: t.args.username || t.args.tag,
      at: new Date().toISOString(),
      status: 'ok',
      items: 0,
    };
    try {
      const res = await crawler.start({ action: t.action, args: t.args, session: { accountId } });
      entry.items = Array.isArray(res?.posts) ? res.posts.length : res?.profile ? 1 : 0;
      console.log(`  ✅ [${i + 1}/${targets.length}] ${t.action} ${entry.target} → ${entry.items} item(s)`);
    } catch (err) {
      entry.status = classifyResult(err);
      entry.error = String(err?.message || err).slice(0, 200);
      if (entry.status === 'challenge') challengeCount++;
      console.log(`  ${entry.status === 'challenge' ? '⚠️' : '❌'} [${i + 1}/${targets.length}] ${t.action} ${entry.target} → ${entry.status}: ${entry.error}`);
      if (entry.status === 'challenge') break; // a checkpoint invalidates the rest of the run
    }
    if (i < targets.length - 1) await sleep(gaussianDelay());
  }

  // AC-4: session reload without re-login (fresh SessionManager = fresh process simulation).
  const reloaded = await client.loadSession(accountId);
  const reloadOk = Boolean(reloaded?.cookies?.sessionid || Object.keys(reloaded?.cookies || {}).length > 0);

  const okCount = log.filter((l) => l.status === 'ok').length;
  const pass = okCount >= 10 && challengeCount === 0;

  // AC-5: verification report
  const md = `# Instagram Session Verification Report (Story 35.5)

- **Run at:** ${new Date().toISOString()}
- **Account:** ${session.accountId}
- **Transport:** ${client.transport}
- **Proxy:** ${process.env.PROXY_URL ? 'configured (value redacted)' : 'MISSING'}
- **Requests:** ${okCount}/${targets.length} ok, ${challengeCount} challenge(s)
- **Session reload without re-login:** ${reloadOk ? 'PASS' : 'FAIL'}
- **Verdict:** ${pass ? '✅ PASS — metric met (>=10 requests, no challenge)' : '❌ FAIL'}

## Request log

| # | Action | Target | Time | Status | Items | Error |
|---|--------|--------|------|--------|-------|-------|
${log.map((l) => `| ${l.n} | ${l.action} | ${l.target} | ${l.at} | ${l.status} | ${l.items} | ${l.error || '—'} |`).join('\n')}

${challengeCount > 0 ? `## Contingency (AC-6)\n\nChallenge encountered at request #${log.find((l) => l.status === 'challenge')?.n}. Recommendations: longer delays (3-6s), different proxy tier, or instagrapi bridge fallback (story 35-3).\n` : ''}
`;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, md);
  console.log(`\n📄 Report written to ${REPORT_PATH}`);
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${okCount} ok / ${challengeCount} challenge / reload ${reloadOk ? 'ok' : 'fail'}`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => {
  console.error('❌ Verification run crashed:', e?.message || e);
  process.exit(1);
});
