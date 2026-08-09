import puppeteer from 'puppeteer';

const COOKIE = {
  c_user: '61591114483304',
  xs: '4%3AjGVa5ow1lFTUAw%3A2%3A1782432919%3A-1%3A-1',
  datr: 'W8Q9aqfd-seOi0zK3trm7lvm',
  sb: 'W8Q9amlBagedtByGNcC030h4',
  fr: '0D8Vc5ScqqXxugAu1.AWcTd2UdKCNGcQqtJhDPGGHvX2S-uguAJYe0egszpff3AHSJAnU.BqPcRc..AAA.0.0.BqPcSW.AWc4aOQRqgAt6CM781YmqkY24C4'
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3628.309 Safari/537.36');

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

const cookies = [
  { name: 'c_user', value: COOKIE.c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: COOKIE.xs, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: COOKIE.datr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: COOKIE.sb, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: COOKIE.fr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 5000));

const result = await page.evaluate(() => {
  return {
    title: document.title,
    url: window.location.href,
    hasLogin: !!document.querySelector('#email'),
    hasAccountMenu: !!document.querySelector('[aria-label="Account"]'),
    hasNotifications: !!document.querySelector('[aria-label="Notifications"]')
  };
});

console.log(`Title: "${result.title}"`);
console.log(`URL: ${result.url}`);
console.log(`Has login: ${result.hasLogin}`);
console.log(`Has account menu: ${result.hasAccountMenu}`);
console.log(`Has notifications: ${result.hasNotifications}`);

const isAlive = !result.hasLogin && (result.hasAccountMenu || result.hasNotifications);
console.log(`\nCookie status: ${isAlive ? 'ALIVE ✅' : 'DEAD ❌'}`);

await browser.close();
