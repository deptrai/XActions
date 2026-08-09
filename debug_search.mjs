import puppeteer from 'puppeteer';

const COOKIE = {
  c_user: '61590064244856',
  xs: '48%3A-vxiobBZqf3qVQ%3A2%3A1786302115%3A-1%3A-1%3A%3AAcxCuIvg82bSik27c5UBYcqMWadR16R1io8rqPx7jA',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1lgJkVvrPzA8p8LGQ.AWdsuIWLLIDmfqFgC_gTaLiKx0ACpoBSC10G6IwuRsmhsuDmcLQ.BqeM6t..AAA.0.0.BqeM6t.AWeWGCL3U7d0SO2KRvvi56lNPwE'
};

const cookies = [
  { name: 'c_user', value: COOKIE.c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: COOKIE.xs, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: COOKIE.datr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: COOKIE.sb, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: COOKIE.fr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3628.309 Safari/537.36');

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

console.log('=== Navigating to search page ===');
await page.goto('https://www.facebook.com/search/posts?q=AI+agent', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

const result = await page.evaluate(() => {
  const r = {};
  r.url = window.location.href;
  r.title = document.title;
  r.articles = document.querySelectorAll('[role="article"]').length;

  // Get all dir=auto elements
  const dirAutos = document.querySelectorAll('[dir="auto"]');
  r.dirAutos = Array.from(dirAutos).slice(0, 10).map(el => ({
    text: el.innerText?.substring(0, 100),
    className: el.className?.substring(0, 80),
    parentTag: el.parentElement?.tagName
  }));

  // Get body text preview
  r.bodyPreview = document.body?.innerText?.substring(0, 1000);

  // Check for h2, h3 elements (sometimes titles are there)
  const headings = document.querySelectorAll('h1, h2, h3');
  r.headings = Array.from(headings).slice(0, 5).map(el => el.innerText?.substring(0, 100));

  // Check for span with specific classes
  const spans = document.querySelectorAll('span');
  const longSpans = Array.from(spans).filter(s => s.innerText?.length > 20 && s.innerText?.length < 500);
  r.longSpans = longSpans.slice(0, 5).map(s => ({
    text: s.innerText?.substring(0, 100),
    className: s.className?.substring(0, 80)
  }));

  return r;
});

console.log(`URL: ${result.url}`);
console.log(`Title: ${result.title}`);
console.log(`Articles: ${result.articles}`);
console.log(`\nDir=auto elements: ${result.dirAutos.length}`);
result.dirAutos.forEach((el, i) => {
  console.log(`  [${i}] "${el.text}"`);
});

console.log(`\nHeadings: ${result.headings.length}`);
result.headings.forEach((h, i) => console.log(`  [${i}] "${h}"`));

console.log(`\nLong spans: ${result.longSpans.length}`);
result.longSpans.forEach((s, i) => console.log(`  [${i}] "${s.text}"`));

console.log(`\nBody preview:\n${result.bodyPreview}`);

await browser.close();
