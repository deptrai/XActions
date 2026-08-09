import puppeteer from 'puppeteer';

// Working cookies
const COOKIES = {
  hoi: {
    name: 'Hoi (61590064244856)',
    c_user: '61590064244856',
    xs: '28:IozFmK0ZxRc0QA:2:1784813151:-1:-1:AcxmMAvaef423d9NH1k-k9GZg54Xn7jv6ArAn-Ba5WrB',
    datr: 'GRZiamd038uppbXzmaHFAvwj',
    sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
    fr: '1OeYlXybhAcKnXnOo.AWc8h_VgvezH1ppa0uD0dXp359mPdb6Nwrj6neJIBhYCO8fEzQ8.Bqd2mc..AAA.0.0.Bqd2mc.AWdQfrXW4X6bNtSz060jSIRx8Fw'
  },
  cookie8: {
    name: 'cookie.txt:8 (61591114483304)',
    c_user: '61591114483304',
    xs: '4%3AjGVa5ow1lFTUAw%3A2%3A1782432919%3A-1%3A-1',
    datr: 'W8Q9aqfd-seOi0zK3trm7lvm',
    sb: 'W8Q9amlBagedtByGNcC030h4',
    fr: '0D8Vc5ScqqXxugAu1.AWcTd2UdKCNGcQqtJhDPGGHvX2S-uguAJYe0egszpff3AHSJAnU.BqPcRc..AAA.0.0.BqPcSW.AWc4aOQRqgAt6CM781YmqkY24C4'
  }
};

async function loginAndCheck(cookie) {
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
    { name: 'c_user', value: cookie.c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
    { name: 'xs', value: cookie.xs, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
    { name: 'datr', value: cookie.datr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
    { name: 'sb', value: cookie.sb, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
    { name: 'fr', value: cookie.fr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  ];
  for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));

  const check = await page.evaluate(() => {
    // Multiple signals for logged in state
    const hasLogin = !!document.querySelector('#email');
    const hasSearch = !!document.querySelector('[role="search"]');
    const hasFeed = !!document.querySelector('[role="feed"]');
    const hasAccountMenu = !!document.querySelector('[aria-label="Account"]') || !!document.querySelector('[aria-label="Your profile"]');
    const hasNotifications = !!document.querySelector('[aria-label="Notifications"]');
    const title = document.title;
    const url = window.location.href;
    const isCheckpoint = url.includes('checkpoint');
    // Title with notification count like "(1) Facebook" = logged in
    const titleHasNotifications = /^\(\d+\)/.test(title);

    return { title, url, hasLogin, hasSearch, hasFeed, hasAccountMenu, hasNotifications, isCheckpoint, titleHasNotifications };
  });

  await browser.close();
  return check;
}

async function main() {
  for (const [key, cookie] of Object.entries(COOKIES)) {
    const result = await loginAndCheck(cookie);
    console.log(`\n=== ${cookie.name} ===`);
    console.log(`  Title: "${result.title}"`);
    console.log(`  URL: ${result.url}`);
    console.log(`  Login form: ${result.hasLogin}`);
    console.log(`  Search: ${result.hasSearch}`);
    console.log(`  Feed: ${result.hasFeed}`);
    console.log(`  Account menu: ${result.hasAccountMenu}`);
    console.log(`  Notifications: ${result.hasNotifications}`);
    console.log(`  Title notifications: ${result.titleHasNotifications}`);
    console.log(`  Checkpoint: ${result.isCheckpoint}`);
    const isAlive = !result.hasLogin && !result.isCheckpoint && (result.hasSearch || result.hasFeed || result.hasAccountMenu || result.hasNotifications || result.titleHasNotifications);
    console.log(`  RESULT: ${isAlive ? 'ALIVE ✅' : 'DEAD/CHECKPOINTED ❌'}`);
  }
}

main().catch(console.error);
