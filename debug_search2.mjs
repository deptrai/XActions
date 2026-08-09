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

await page.goto('https://www.facebook.com/search/posts?q=AI+agent', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

// Get the first article's full HTML structure
const result = await page.evaluate(() => {
  const articles = document.querySelectorAll('[role="article"]');
  if (articles.length === 0) return { error: 'No articles found' };

  const article = articles[0];

  // Find all elements with aria-label
  const ariaElements = article.querySelectorAll('[aria-label]');
  const ariaLabels = Array.from(ariaElements).map(el => ({
    tag: el.tagName,
    ariaLabel: el.getAttribute('aria-label')?.substring(0, 200),
    textContent: el.textContent?.substring(0, 100)
  }));

  // Find all img with alt
  const imgs = article.querySelectorAll('img[alt]');
  const imgAlts = Array.from(imgs).map(el => ({
    alt: el.getAttribute('alt')?.substring(0, 200),
    src: el.src?.substring(0, 100)
  }));

  // Find all spans with text
  const spans = article.querySelectorAll('span');
  const spanTexts = Array.from(spans)
    .filter(s => s.innerText?.length > 5 && s.innerText?.length < 500)
    .map(s => ({
      text: s.innerText?.substring(0, 200),
      className: s.className?.substring(0, 80),
      dir: s.getAttribute('dir')
    }));

  // Get the innerHTML of the article (first 3000 chars)
  const html = article.innerHTML.substring(0, 3000);

  return { ariaLabels, imgAlts, spanTexts, html };
});

console.log('=== Article Analysis ===');
console.log(`\nAria labels (${result.ariaLabels?.length || 0}):`);
result.ariaLabels?.forEach((el, i) => {
  console.log(`  [${i}] ${el.tag}: "${el.ariaLabel}" (text: "${el.textContent}")`);
});

console.log(`\nImage alts (${result.imgAlts?.length || 0}):`);
result.imgAlts?.forEach((el, i) => {
  console.log(`  [${i}] alt: "${el.alt?.substring(0, 100)}"`);
});

console.log(`\nSpan texts (${result.spanTexts?.length || 0}):`);
result.spanTexts?.forEach((el, i) => {
  console.log(`  [${i}] dir=${el.dir}, class=${el.className?.substring(0, 40)}: "${el.text?.substring(0, 100)}"`);
});

console.log(`\nHTML preview:\n${result.html?.substring(0, 2000)}`);

await browser.close();
