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
await page.setViewport({ width: 1280, height: 800 });
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

// Screenshot 1: Home page (logged in)
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/evidence_home.png', fullPage: false });
console.log('Screenshot 1: Home page saved');

// Screenshot 2: Group page
await page.goto('https://www.facebook.com/groups/opensource', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/evidence_group.png', fullPage: false });
console.log('Screenshot 2: Group page saved');

// Screenshot 3: Profile page
await page.goto('https://www.facebook.com/nichxbt', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/evidence_profile.png', fullPage: false });
console.log('Screenshot 3: Profile page saved');

await browser.close();
console.log('Done!');
