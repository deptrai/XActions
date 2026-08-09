import puppeteer from 'puppeteer';

const COOKIES = [
  { name: 'c_user', value: '61590064244856', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: '48%3A-vxiobBZqf3qVQ%3A2%3A1786302115%3A-1%3A-1%3A%3AAcxCuIvg82bSik27c5UBYcqMWadR16R1io8rqPx7jA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: 'GRZiamd038uppbXzmaHFAvwj', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: 'GhZiah6ZnKyzonT4_VLPWhHA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: '1lgJkVvrPzA8p8LGQ.AWdsuIWLLIDmfqFgC_gTaLiKx0ACpoBSC10G6IwuRsmhsuDmcLQ.BqeM6t..AAA.0.0.BqeM6t.AWeWGCL3U7d0SO2KRvvi56lNPwE', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
// Use mobile user agent like the scraper does for groups
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

await page.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

for (const c of COOKIES) {
  try { await page.setCookie(c); } catch(e) {}
}

// Navigate to mobile group page
await page.goto('https://m.facebook.com/groups/opensource', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

const result = await page.evaluate(() => {
  const mDisplayed = document.querySelectorAll('div.m.displayed');
  const posts = [];
  mDisplayed.forEach((el, i) => {
    const text = el.innerText?.trim() || '';
    if (text.length > 5) {
      posts.push({
        index: i,
        textLen: text.length,
        textPreview: text.substring(0, 200)
      });
    }
  });
  return {
    url: window.location.href,
    title: document.title,
    mDisplayedCount: mDisplayed.length,
    postsWithText: posts.length,
    posts: posts.slice(0, 3)
  };
});

console.log(`URL: ${result.url}`);
console.log(`Title: ${result.title}`);
console.log(`div.m.displayed count: ${result.mDisplayedCount}`);
console.log(`Posts with text: ${result.postsWithText}`);
result.posts.forEach(p => {
  console.log(`\n[${p.index}] (${p.textLen} chars): ${p.textPreview}`);
});

await browser.close();
