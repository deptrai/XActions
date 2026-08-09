import puppeteer from 'puppeteer';

const COOKIES = [
  { name: 'c_user', value: '61590064244856', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: '48%3A-vxiobBZqf3qVQ%3A2%3A1786302115%3A-1%3A-1%3A%3AAcxCuIvg82bSik27c5UBYcqMWadR16R1io8rqPx7jA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: 'GRZiamd038uppbXzmaHFAvwj', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: 'GhZiah6ZnKyzonT4_VLPWhHA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: '1lgJkVvrPzA8p8LGQ.AWdsuIWLLIDmfqFgC_gTaLiKx0ACpoBSC10G6IwuRsmhsuDmcLQ.BqeM6t..AAA.0.0.BqeM6t.AWeWGCL3U7d0SO2KRvvi56lNPwE', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'ps_l', value: '1', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  { name: 'ps_n', value: '1', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
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

for (const c of COOKIES) {
  try { await page.setCookie(c); } catch(e) {}
}

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 5000));

const result = await page.evaluate(() => {
  return {
    title: document.title,
    url: window.location.href,
    hasLogin: !!document.querySelector('#email'),
    hasAccountMenu: !!document.querySelector('[aria-label="Account"]'),
    hasNotifications: !!document.querySelector('[aria-label="Notifications"]'),
    bodyPreview: document.body?.innerText?.substring(0, 300)
  };
});

console.log(`Title: "${result.title}"`);
console.log(`URL: ${result.url}`);
console.log(`Has login: ${result.hasLogin}`);
console.log(`Has account menu: ${result.hasAccountMenu}`);
console.log(`Has notifications: ${result.hasNotifications}`);
console.log(`Body preview: ${result.bodyPreview}`);

const isAlive = !result.hasLogin && (result.hasAccountMenu || result.hasNotifications);
console.log(`\nCookie status: ${isAlive ? 'ALIVE ✅' : 'DEAD ❌'}`);

await browser.close();
