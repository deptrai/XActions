import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:18801');
const ctx = browser.contexts()[0];
console.log('contexts:', browser.contexts().length, '| pages in ctx0:', ctx.pages().length);

// KHÔNG đụng cookie — dùng phiên sống sẵn
const page = await ctx.newPage();
const graphqlHits = [];
page.on('response', async (resp) => {
  try {
    const u = resp.url() || '';
    if (!u.includes('/api/graphql/')) return;
    const req = resp.request();
    const pd = req.postData() || '';
    if (!pd.includes('SearchCometResultsPaginatedResultsQuery')) return;
    const body = await resp.text();
    graphqlHits.push({ status: resp.status(), len: body.length, body });
  } catch {}
});

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const txt = await page.evaluate(() => document.body.innerText.slice(0, 300));
const loggedOut = /Đăng nhập vào Facebook|Log in to Facebook/.test(txt);
console.log('logged out?', loggedOut);

if (!loggedOut) {
  const url = 'https://www.facebook.com/search/posts/?q=' + encodeURIComponent('cần mua macbook pro m1 14');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollBy(0, 2500)).catch(() => {});
  }
  const html = await page.content();
  writeFileSync('/tmp/fb_search_live.html', html);
  console.log('html saved:', html.length);
  console.log('graphql search responses:', graphqlHits.length);
  // Lưu response GraphQL để bóc cấu trúc
  let i = 0;
  for (const g of graphqlHits.slice(0, 3)) {
    writeFileSync('/tmp/fb_gql_resp_' + (i++) + '.json', g.body);
    console.log('saved resp', g.status, g.len);
  }
}
await page.close().catch(() => {});
process.exit(0);