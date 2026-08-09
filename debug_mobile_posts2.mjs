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

console.log('=== Navigating to group on mobile ===');
await page.goto('https://m.facebook.com/groups/opensource', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

const result = await page.evaluate(() => {
  const r = {};
  r.url = window.location.href;
  r.title = document.title;
  r.mDisplayed = document.querySelectorAll('div.m.displayed').length;
  r.mClass = document.querySelectorAll('div.m').length;
  r.articles = document.querySelectorAll('[role="article"]').length;
  r.bodyLen = document.body?.innerText?.length;
  r.bodyPreview = document.body?.innerText?.substring(0, 500);
  return r;
});

console.log(`URL: ${result.url}`);
console.log(`Title: ${result.title}`);
console.log(`div.m.displayed: ${result.mDisplayed}`);
console.log(`div.m: ${result.mClass}`);
console.log(`[role="article"]: ${result.articles}`);
console.log(`Body length: ${result.bodyLen}`);
console.log(`Body preview:\n${result.bodyPreview}`);

// Scroll and check again
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 2000));
}

const result2 = await page.evaluate(() => {
  return {
    mDisplayed: document.querySelectorAll('div.m.displayed').length,
    mClass: document.querySelectorAll('div.m').length,
    bodyPreview: document.body?.innerText?.substring(0, 500)
  };
});

console.log(`\nAfter scroll:`);
console.log(`div.m.displayed: ${result2.mDisplayed}`);
console.log(`div.m: ${result2.mClass}`);
console.log(`Body preview:\n${result2.bodyPreview}`);

await browser.close();
