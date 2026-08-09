import puppeteer from 'puppeteer';

const COOKIE = {
  c_user: '61590064244856',
  xs: '28:IozFmK0ZxRc0QA:2:1784813151:-1:-1:AcxmMAvaef423d9NH1k-k9GZg54Xn7jv6ArAn-Ba5WrB',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1OeYlXybhAcKnXnOo.AWc8h_VgvezH1ppa0uD0dXp359mPdb6Nwrj6neJIBhYCO8fEzQ8.Bqd2mc..AAA.0.0.Bqd2mc.AWdQfrXW4X6bNtSz060jSIRx8Fw'
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

await page.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

const cookies = [
  { name: 'c_user', value: COOKIE.c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: COOKIE.xs, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: COOKIE.datr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: COOKIE.sb, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: COOKIE.fr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

console.log('=== Mobile: Navigating to group ===');
await page.goto('https://m.facebook.com/groups/opensource', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 5000));

let result = await page.evaluate(() => {
  return {
    title: document.title,
    url: window.location.href,
    bodyText: document.body?.innerText?.substring(0, 800),
    articles: document.querySelectorAll('[role="article"]').length,
    divCount: document.querySelectorAll('div').length
  };
});

console.log(`Title: "${result.title}"`);
console.log(`URL: ${result.url}`);
console.log(`Articles: ${result.articles}`);
console.log(`Body text:\n${result.bodyText}`);

// Scroll to load more
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 2000));
}

result = await page.evaluate(() => {
  const articles = document.querySelectorAll('[role="article"]');
  const posts = [];
  articles.forEach((a, idx) => {
    const text = a.innerText?.trim();
    if (text && text.length > 20) {
      posts.push({
        index: idx,
        textLength: text.length,
        textPreview: text.substring(0, 200)
      });
    }
  });
  return {
    articles: articles.length,
    postsWithText: posts.length,
    posts: posts.slice(0, 3)
  };
});

console.log(`\nAfter scroll - Articles: ${result.articles}, Posts with text: ${result.postsWithText}`);
result.posts.forEach(p => {
  console.log(`\n[${p.index}] (${p.textLength} chars): ${p.textPreview}`);
});

await browser.close();
