import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

// Test login state của ~/.xactions/chrome-profile (profile dùng capture docId lần 26/08)
const ctx = await chromium.launchPersistentContext('/Users/luisphan/.xactions/chrome-profile', {
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: 'vi-VN',
});
const page = ctx.pages()[0] || await ctx.newPage();
const graphql = [];
page.on('request', req => {
  const u = req.url() || '';
  if (u.includes('/api/graphql/')) {
    const pd = req.postData() || '';
    for (const m of pd.matchAll(/doc_id[=:]"?(\d{12,22})"?/g)) graphql.push({ docId: m[1], body: pd.slice(0, 600) });
  }
});
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
const txt = await page.evaluate(() => document.body.innerText.slice(0, 400));
const loggedOut = /Đăng nhập vào Facebook|Log in to Facebook/.test(txt);
console.log('logged out?', loggedOut);
console.log('head:', txt.replace(/\s+/g, ' ').slice(0, 150));
if (!loggedOut) {
  await page.goto('https://www.facebook.com/search/posts/?q=' + encodeURIComponent('cần mua macbook pro m1'), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy(0, 2500)).catch(() => {});
  }
  console.log('graphql captured:', graphql.length);
  const uniq = {};
  for (const g of graphql) uniq[g.docId] ||= g.body;
  writeFileSync('/tmp/fb_docids.json', JSON.stringify(uniq, null, 1));
  console.log('unique docIds:', Object.keys(uniq).length);
  for (const [id, body] of Object.entries(uniq)) {
    const isSearch = /search|serp|SearchResult/i.test(body);
    console.log(isSearch ? '★' : '•', id, isSearch ? '| SEARCH' : '');
  }
  // Lưu luôn HTML kết quả search để bóc links
  const html = await page.content();
  writeFileSync('/tmp/fb_search.html', html);
  console.log('html saved:', html.length);
}
await ctx.close().catch(() => {});
process.exit(0);