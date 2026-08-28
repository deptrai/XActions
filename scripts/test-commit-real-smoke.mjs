// Sentinel real-data smoke test for the recent auth/guest/token-ring commit.
// Exercises FacebookClient and FacebookCrawler against live facebook.com.
// Reads cookie from ~/.xactions/facebook-cookies.json when an auth profile is requested.
// Loads a rotating residential proxy from PROXY_URL (or FACEBOOK_PROXY).
// Logs only result counts and health signals; never prints cookie or proxy credentials.

import 'dotenv/config';
import { FacebookClient, FacebookCrawler } from '../src/scrapers/social/facebook/index.js';
import { ProxyIpPool } from '../src/proxy/proxy-pool.js';
import { readFileSync } from 'node:fs';

const COOKIE_PATH = `${process.env.HOME}/.xactions/facebook-cookies.json`;
const PROXY_URL = process.env.PROXY_URL
  || (process.env.FACEBOOK_PROXY && process.env.FACEBOOK_PROXY_AUTH_USERNAME
    ? `http://${process.env.FACEBOOK_PROXY_AUTH_USERNAME}:${process.env.FACEBOOK_PROXY_AUTH_PASSWORD}@${process.env.FACEBOOK_PROXY.replace(/^https?:\/\//, '')}`
    : '');

if (!PROXY_URL) {
  console.error('No PROXY_URL or FACEBOOK_PROXY in environment. Smoke test needs a residential proxy.');
  process.exit(1);
}

const proxyPool = new ProxyIpPool({ proxies: [PROXY_URL] });

function loadCookieHeader() {
  const raw = JSON.parse(readFileSync(COOKIE_PATH, 'utf8'));
  const cookies = Array.isArray(raw) ? raw : (raw.cookies || []);
  const c_user = cookies.find((c) => c.name === 'c_user')?.value;
  const xs = cookies.find((c) => c.name === 'xs')?.value;
  if (!c_user || !xs) throw new Error('Missing c_user/xs in cookie file');
  return `c_user=${c_user}; xs=${xs}`;
}

function redactToken(tok) {
  if (typeof tok !== 'string' || tok.length < 8) return tok ? '[token]' : '[empty]';
  return `${tok.slice(0, 4)}...${tok.slice(-4)}`;
}

async function runGuestClientSmoke() {
  console.log('\n[GUEST CLIENT SMOKE] Fetching www.facebook.com with no cookie');
  const client = new FacebookClient({ timeout: 30000, httpFallback: true, proxyPool });
  const tokens = await client.ensureTokens(null, '');
  console.log(`  guest tokens: c_user=${tokens.c_user} lsd=${redactToken(tokens.lsd)} jazoest=${redactToken(tokens.jazoest)}`);
  if (tokens.c_user !== '0') throw new Error('Guest token extraction returned non-zero c_user');

  const body = client.buildGraphQlBody('fb_marketplace_search_doc', { query: 'macbook' }, tokens, { requiresAuth: false });
  const params = new URLSearchParams(body);
  console.log(`  guest GraphQL body: __user=${params.get('__user')} lsd=${redactToken(params.get('lsd'))} (fromGuestRing=${client.guestTokenRing?.size > 0})`);
  await client.close?.();
}

async function runAuthClientSmoke() {
  console.log('\n[AUTH CLIENT SMOKE] Fetching www.facebook.com with real cookie');
  const cookieHeader = loadCookieHeader();
  const client = new FacebookClient({ timeout: 30000, httpFallback: true, proxyPool });
  const tokens = await client.ensureTokens('real_account', cookieHeader);
  const cUserIsZero = tokens.c_user === '0';
  console.log(`  auth tokens: c_user=${cUserIsZero ? '0' : '[redacted]'} lsd=${redactToken(tokens.lsd)}`);
  if (cUserIsZero) throw new Error('Auth token extraction returned zero c_user');

  const body = client.buildGraphQlBody('fb_marketplace_search_doc', { query: 'macbook' }, tokens, { accountId: 'real_account' });
  const params = new URLSearchParams(body);
  console.log(`  auth GraphQL body: __user=${params.get('__user') === '0' ? '0' : '[redacted]'} lsd=${redactToken(params.get('lsd'))} (fromAuthRing=${client.tokenRing?.size > 0})`);
  await client.close?.();
}

async function runCrawler(name, command, opts = {}) {
  console.log(`\n[CRAWLER: ${name}] action=${command.action} args=${JSON.stringify(command.args)}`);
  const crawler = new FacebookCrawler({ timeout: 45000, proxyPool, ...opts });
  try {
    const result = await crawler.start(command);
    const count = result?.posts?.length ?? 0;
    console.log(`  status: ok  posts=${count} note=${result?.note || '(none)'} dryRun=${!!result?.dryRun}`);
    for (const p of (result?.posts || []).slice(0, 2)) {
      console.log(`    post: id=${p.id} title=${(p.content || '').slice(0, 40)} price=${p.metadata?.price || 'n/a'} location=${p.metadata?.location || 'n/a'}`);
    }
    return { test: name, ok: true, count, result };
  } catch (err) {
    console.log(`  status: error  code=${err.code || 'N/A'} type=${err.type || 'N/A'} message=${err.message || String(err)}`);
    return { test: name, ok: false, err };
  } finally {
    await crawler.cleanup?.();
  }
}

async function main() {
  const summary = [];

  try {
    await runGuestClientSmoke();
    summary.push({ test: 'guest-client-tokens', ok: true });
  } catch (err) {
    console.error(`  [GUEST CLIENT SMOKE FAILED] ${err.message}`);
    summary.push({ test: 'guest-client-tokens', ok: false, message: err.message });
  }

  try {
    await runAuthClientSmoke();
    summary.push({ test: 'auth-client-tokens', ok: true });
  } catch (err) {
    console.error(`  [AUTH CLIENT SMOKE FAILED] ${err.message}`);
    summary.push({ test: 'auth-client-tokens', ok: false, message: err.message });
  }

  summary.push(await runCrawler('guest-marketplace', { action: 'marketplace', args: { query: 'macbook', location: 'hochiminhcity', limit: 2 } }));
  summary.push(await runCrawler('guest-search', { action: 'search', args: { query: 'macbook', type: 'posts', location: 'hochiminhcity', limit: 2 } }));
  summary.push(await runCrawler('guest-profile', { action: 'profile', args: { username: 'zuck' } }));
  summary.push(await runCrawler('guest-page-posts', { action: 'page_posts', args: { pageId: 'zuck', limit: 2 } }));

  try {
    const cookie = loadCookieHeader();
    const authSession = { accountId: 'real_account', cookies: cookie, requiresAuth: true };
    summary.push(await runCrawler('auth-marketplace', { action: 'marketplace', args: { query: 'macbook', location: 'hochiminhcity', limit: 2 }, session: authSession }));
    summary.push(await runCrawler('auth-profile', { action: 'profile', args: { username: 'zuck' }, session: authSession }));
    summary.push(await runCrawler('auth-group-members', { action: 'group_members', args: { groupUrl: 'https://www.facebook.com/groups/opensource', limit: 2 }, session: authSession }));
  } catch (err) {
    console.error(`  [AUTH INFRA] ${err.message}`);
    summary.push({ test: 'auth-infra', ok: false, message: err.message });
  }

  console.log('\n=== SUMMARY ===');
  const passed = summary.filter((s) => s.ok).length;
  const failed = summary.filter((s) => !s.ok).length;
  for (const s of summary) console.log(`  ${s.ok ? '✓' : '✗'} ${s.test}`);
  console.log(`passed: ${passed} / ${summary.length}, failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
