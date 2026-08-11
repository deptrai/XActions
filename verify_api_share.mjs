import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const COOKIE = {
  c_user: '61551532654077',
  xs: '36:S-jWTjZkyhJFPA:2:1786256246:-1:-1',
  datr: 'hvlpaq9byAlvhl67oieOPTwH',
};

async function verify() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Set cookies
  await context.addCookies([
    { name: 'c_user', value: COOKIE.c_user, domain: '.facebook.com', path: '/' },
    { name: 'xs', value: COOKIE.xs, domain: '.facebook.com', path: '/' },
    { name: 'datr', value: COOKIE.datr, domain: '.facebook.com', path: '/' },
  ]);

  // Login
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Navigate to conversation with "Facebook user"
  console.log('Checking conversation with Facebook user...');
  await page.goto('https://www.facebook.com/messages/t/1172593649275563/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const content = await page.evaluate(() => document.body?.innerText?.substring(0, 400));
  console.log(`Content: ${content}`);

  const hasPost = content?.includes('IsraelClouds') || content?.includes('Amazon Quick') || content?.includes('Check out this post');
  console.log(`Contains shared post: ${hasPost}`);

  await browser.close();
}

verify().catch(console.error);
