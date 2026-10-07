import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const raw = JSON.parse(readFileSync('/Users/luisphan/.medirus/facebook-cookies.json', 'utf8'));
const ck = raw.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain || '.facebook.com',
  path: c.path || '/',
  secure: c.secure !== false,
  httpOnly: ['c_user','xs','fr','datr'].includes(c.name),
  ...(c.session ? {} : { expires: c.expirationDate || Math.floor(Date.now()/1000) + 7776000 }),
}));

const browser = await chromium.connectOverCDP('http://127.0.0.1:18801');
// Tạo context MỚI sạch
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'vi-VN',
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(ck);

const page = await ctx.newPage();
const graphql = [];
page.on('request', req => {
  const u = req.url() || '';
  if (u.includes('/api/graphql/')) {
    const pd = req.postData() || '';
    for (const m of pd.matchAll(/doc_id[=:]"?(\d{12,22})"?/g)) graphql.push({ docId: m[1], body: pd.slice(0, 500) });
  }
});

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
const txt = await page.evaluate(() => document.body.innerText.slice(0, 500));
console.log('login-wall?', /Đăng nhập Facebook|Log in to Facebook/.test(txt));
console.log('page head:', txt.replace(/\n+/g, ' | ').slice(0, 200));

await page.goto('https://www.facebook.com/search/posts/?q=' + encodeURIComponent('cần mua macbook pro m1'), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollBy(0, 2500)).catch(() => {});
}
console.log('graphql captured:', graphql.length);
const uniq = {};
for (const g of graphql) uniq[g.docId] ||= g.body;
writeFileSync('/tmp/fb_docids.json', JSON.stringify(uniq, null, 1));
console.log('unique docIds:', Object.keys(uniq).length);
// tìm docId của search results
for (const [id, body] of Object.entries(uniq)) {
  const isSearch = /search|SearchResult|serp/i.test(body);
  console.log((isSearch ? '★' : '•'), id, isSearch ? '| SEARCH-RELATED' : '');
  if (isSearch) console.log('   body:', body.slice(0, 200).replace(/\n/g, ' '));
}
await ctx.close().catch(() => {});
process.exit(0);