// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterCrawler action audit — runs every registered action once and records
 * its real-world status (guest vs authenticated, OK / failed / skipped).
 *
 * Run without auth:
 *   node scripts/audit-twitter-actions.mjs
 * Run with auth:
 *   XACTIONS_SESSION_COOKIE='auth_token=...; ct0=...' node scripts/audit-twitter-actions.mjs
 */
import { TwitterCrawler } from '../src/scrapers/social/twitter/crawler.js';

const TWEET_ID = '2094884934510956691';
const USERNAME = 'nasa';
const LIST_ID = '1536016715899326464'; // public list (may not exist)
const COMMUNITY_ID = '1492545558379008003';

const AUTH = process.env.XACTIONS_SESSION_COOKIE || '';
const authSession = AUTH ? { cookies: AUTH } : {};

// Build a crawler for the requested auth context.
function makeCrawler(session = {}) {
  return new TwitterCrawler({});
}

// Helper to build action command.
function cmd(action, args = {}, session = {}) {
  return { action, args, session };
}

const ACTIONS = [
  // Public / guest-friendly
  { action: 'profile', args: { username: USERNAME }, guest: true },
  { action: 'media', args: { username: USERNAME, limit: 3 }, guest: true },
  { action: 'thread', args: { tweetId: TWEET_ID }, guest: true },
  { action: 'thread', args: { tweetId: TWEET_ID, walkToRoot: true }, guest: true, label: 'thread (walkToRoot)' },
  { action: 'trending', args: { limit: 5 }, guest: true },
  { action: 'download_video', args: { tweetId: TWEET_ID, quality: 'highest' }, guest: true },

  // Search is now auth-only
  { action: 'search', args: { query: 'javascript', limit: 3 }, guest: false },
  { action: 'hashtag', args: { tag: 'javascript', limit: 3 }, guest: false },
  { action: 'spaces', args: { query: 'crypto', limit: 3 }, guest: false },

  // Relationship / content (auth required)
  { action: 'followers', args: { username: USERNAME, limit: 3 }, guest: false },
  { action: 'following', args: { username: USERNAME, limit: 3 }, guest: false },
  { action: 'retweeters', args: { tweetId: TWEET_ID, limit: 3 }, guest: false },
  { action: 'non_followers', args: { username: USERNAME, limit: 3 }, guest: false },
  { action: 'list_members', args: { listId: LIST_ID, limit: 3 }, guest: false },
  { action: 'community_members', args: { communityId: COMMUNITY_ID, limit: 3 }, guest: false },
  { action: 'likes', args: { tweetId: TWEET_ID, limit: 3 }, guest: false },
  { action: 'likers', args: { tweetId: TWEET_ID, limit: 3 }, guest: false },
  { action: 'bookmarks', args: { limit: 3 }, guest: false },

  // Write actions — run dry-run to avoid side effects.
  { action: 'post', args: { text: 'XActions audit dry run', dryRun: true }, guest: false },
  { action: 'reply', args: { tweetId: TWEET_ID, text: 'Reply audit dry run', dryRun: true }, guest: false },
  { action: 'quote', args: { tweetId: TWEET_ID, text: 'Quote audit dry run', dryRun: true }, guest: false },
  { action: 'schedule', args: { text: 'Scheduled audit dry run', publishAt: '2030-01-01T00:00:00Z', dryRun: true }, guest: false },
  { action: 'like', args: { tweetId: TWEET_ID, dryRun: true }, guest: false },
  { action: 'unlike', args: { tweetId: TWEET_ID, dryRun: true }, guest: false },
  { action: 'retweet', args: { tweetId: TWEET_ID, dryRun: true }, guest: false },
  { action: 'undo_retweet', args: { tweetId: TWEET_ID, dryRun: true }, guest: false },
  { action: 'follow', args: { username: USERNAME, dryRun: true }, guest: false },
  { action: 'unfollow', args: { username: USERNAME, dryRun: true }, guest: false },
  { action: 'block', args: { username: USERNAME, dryRun: true }, guest: false },
  { action: 'unblock', args: { username: USERNAME, dryRun: true }, guest: false },
  { action: 'mute', args: { username: USERNAME, dryRun: true }, guest: false },
  { action: 'unmute', args: { username: USERNAME, dryRun: true }, guest: false },
  { action: 'bookmark', args: { tweetId: TWEET_ID, dryRun: true }, guest: false },
  { action: 'unbookmark', args: { tweetId: TWEET_ID, dryRun: true }, guest: false },
  { action: 'create_list', args: { name: 'XActions Audit', dryRun: true }, guest: false },
  { action: 'add_list_members', args: { listId: LIST_ID, usernames: [USERNAME], dryRun: true }, guest: false },
  { action: 'remove_list_members', args: { listId: LIST_ID, usernames: [USERNAME], dryRun: true }, guest: false },
  { action: 'send_dm', args: { username: USERNAME, text: 'DM audit dry run', dryRun: true }, guest: false },
  { action: 'dm_conversations', args: { limit: 3 }, guest: false },
  { action: 'dm_messages', args: { conversationId: '1-2', limit: 3 }, guest: false },
];

const results = [];
let pass = 0;
let fail = 0;
let skip = 0;

for (const { action, args, guest, label } of ACTIONS) {
  const session = guest ? {} : authSession;
  const display = label || action;
  const expected = guest ? 'guest' : 'auth';
  const start = Date.now();
  const crawler = makeCrawler(session);
  try {
    const res = await crawler.start(cmd(action, args, session));
    const duration = Date.now() - start;
    const itemCount = Array.isArray(res)
      ? res.length
      : (res?.items?.length ?? res?.posts?.length ?? res?.trends?.length ?? res?.followers?.length ?? res?.following?.length ?? res?.likers?.length ?? res?.members?.length ?? res?.nonFollowers?.length ?? (res?.profile ? 1 : res?.success ? 1 : 'n/a'));
    results.push({ action: display, expected, status: 'OK', duration, itemCount, message: '' });
    pass++;
    console.log(`✅ ${display} OK (${duration}ms) items=${itemCount}`);
  } catch (err) {
    const duration = Date.now() - start;
    const status = err?.code === 'XACT_4010' || err?.type === 'auth_expired' ? 'AUTH_REQUIRED' : 'FAIL';
    results.push({ action: display, expected, status, duration, itemCount: 0, message: err?.message || String(err) });
    if (status === 'AUTH_REQUIRED') {
      skip++;
    } else {
      fail++;
    }
    console.log(`❌ ${display} ${status} (${duration}ms) ${err?.type || err?.name || 'Error'}: ${err?.message || err}`);
  }
}

const markdown = `# TwitterCrawler Action Audit — ${new Date().toISOString()}

| # | Action | Expected | Status | Duration (ms) | Items | Message |
|---|--------|----------|--------|---------------|-------|---------|
${results.map((r, i) => `| ${i + 1} | ${r.action} | ${r.expected} | ${r.status} | ${r.duration} | ${r.itemCount} | ${r.message.replace(/\|/g, '\\|').slice(0, 80)} |`).join('\n')}

## Summary

- **Total**: ${results.length}
- **OK**: ${pass}
- **AUTH_REQUIRED / Skipped**: ${skip}
- **FAIL (other)**: ${fail}
- **Auth cookie present**: ${AUTH ? 'yes' : 'no'}

## Notes

- Actions marked **guest** should succeed without an account.
- Actions marked **auth** require an authenticated session (\`auth_token\` + \`ct0\` cookies).
- Write actions were executed with \`dryRun: true\` to avoid side effects; real write actions need auth.
- \`search\`, \`hashtag\`, and \`spaces\*\` currently require auth because X/Twitter closed guest SearchTimeline in 2026-09.
- \`thread\*\*\*\* returns the root tweet for guests; full conversation still requires auth.
`;

await (await import('node:fs/promises')).writeFile('_bmad-output/implementation-artifacts/twitter-action-audit.md', markdown);

console.log('\n---');
console.log(`Audit complete: ${pass} OK, ${skip} auth-required, ${fail} failed`);
console.log('Report written to _bmad-output/implementation-artifacts/twitter-action-audit.md');
