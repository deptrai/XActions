// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Comprehensive LIVE test of ALL Facebook no-auth scraper actions.
 * Runs every requiresAuth:false action against real Facebook endpoints.
 */
import { FacebookCrawler } from '../src/scrapers/social/facebook/crawler.js';

const crawler = new FacebookCrawler({ requiresProxy: false });
const TIMEOUT_MS = 90000;

const withTimeout = (p, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
]);

function summarize(res) {
  if (res == null) return 'null';
  const keys = ['posts','comments','followers','following','members','pages','people','groups','listings','results'];
  const out = {};
  for (const k of keys) {
    if (Array.isArray(res[k])) { out[k] = res[k].length; }
  }
  if (res.profile) out.profile = { id: res.profile.id, name: res.profile.name, username: res.profile.username };
  if (res.note) out.note = String(res.note).slice(0,120);
  if (res.pageInfo) out.pageInfo = res.pageInfo;
  if (res.searchUrl) out.searchUrl = String(res.searchUrl).slice(0,80);
  if (Object.keys(out).length === 0) {
    const arr = Array.isArray(res) ? res : (res.posts||res.comments||res.results||[]);
    return `keys=[${Object.keys(res).join(',')}] len=${Array.isArray(arr)?arr.length:'?'}`;
  }
  return JSON.stringify(out);
}

const TESTS = [
  ['profile',        { action:'profile',        args:{ username:'zuck' } }],
  ['followers',      { action:'followers',      args:{ username:'zuck', limit:10 } }],
  ['following',      { action:'following',      args:{ username:'zuck' } }],
  ['page_posts',     { action:'page_posts',     args:{ pageId:'zuck', count:5 } }],
  ['search',         { action:'search',         args:{ query:'technology', type:'pages', limit:5 } }],
  ['search(posts)',  { action:'search',         args:{ query:'artificial intelligence', type:'posts', limit:5 } }],
  ['marketplace',    { action:'marketplace',    args:{ query:'macbook', location:'Ho Chi Minh City', limit:5 } }],
  ['group_posts',    { action:'group_posts',    args:{ groupId:'opensource', count:5 } }],
  ['group_members',  { action:'group_members',  args:{ groupUrl:'https://www.facebook.com/groups/opensource', limit:10 } }],
  ['group_search',   { action:'group_search',   args:{ groupUrl:'https://www.facebook.com/groups/opensource', query:'linux', limit:5 } }],
  ['post_comments',  { action:'post_comments',  args:{ url:'https://www.facebook.com/zuck/posts/2177656666179131', maxComments:10, includeReplies:true } }],
  ['get_comments',   { action:'get_comments',   args:{ postId:'2177656666179131', maxComments:10 } }],
];

const results = [];
for (const [label, req] of TESTS) {
  process.stdout.write(`\n▶ ${label} ... `);
  const t0 = Date.now();
  try {
    const res = await withTimeout(crawler.start(req), label);
    const ms = Date.now()-t0;
    console.log(`\n✅ ${label} (${ms}ms): ${summarize(res)}`);
    results.push({ label, status:'PASS', ms, summary:summarize(res) });
  } catch (err) {
    const ms = Date.now()-t0;
    console.log(`\n❌ ${label} (${ms}ms): ${err.message} [code=${err.code||'-'} type=${err.type||'-'}]`);
    results.push({ label, status:'FAIL', ms, error:err.message, code:err.code, type:err.type });
  }
}

console.log('\n================ SUMMARY ================');
const pass = results.filter(r=>r.status==='PASS').length;
for (const r of results) console.log(`${r.status==='PASS'?'✅':'❌'} ${r.label.padEnd(16)} ${r.status==='PASS'?r.summary:(r.error||'').slice(0,90)}`);
console.log(`\n${pass}/${results.length} no-auth actions PASSED`);
await crawler.cleanup().catch(()=>{});
process.exit(pass===results.length?0:1);
