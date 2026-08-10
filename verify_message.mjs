import puppeteer from 'puppeteer';
import { loginWithCookie, createBrowser, createPage } from './src/scrapers/facebook/index.js';

const COOKIE = {
  c_user: '61590064244856',
  xs: '36%3AqI-IugaHc8Banw%3A2%3A1786333693%3A-1%3A-1%3A%3AAcyVi7Zj44320dtXuxytXcsjeRQZnWml2fYh8qHT6w',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1l9B1TVKb8KNftISg.AWdeNAQ1vOdA4FI26_Z7Au3DdE0yFJroHT_56gscE-bob4M-AF8.BqeUoA..AAA.0.0.BqeUoA.AWcSMOEU-bYhOSS63iCbYYJs9Ww'
};

async function verifyMessage() {
  const browser = await createBrowser({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await createPage(browser);

  // Navigate to Facebook first
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Set cookies directly
  for (const [name, value] of Object.entries(COOKIE)) {
    await page.setCookie({
      name,
      value,
      domain: '.facebook.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'None',
    });
  }

  // Navigate to Facebook to verify login
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const loginState = await page.evaluate(() => ({
    hasLogin: !!document.querySelector('#email'),
    bodyPreview: document.body?.innerText?.substring(0, 100)
  }));

  console.log(`Login: ${loginState.hasLogin}`);
  console.log(`Body: ${loginState.bodyPreview}`);

  if (loginState.hasLogin) {
    console.log('❌ Login failed');
    await browser.close();
    return;
  }

  // Navigate to the conversation
  const uid = '284871858534684';
  console.log(`\nNavigating to conversation: https://www.facebook.com/messages/t/${uid}`);
  await page.goto(`https://www.facebook.com/messages/t/${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Take screenshot
  await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/verify_message.png' });
  console.log('📸 Screenshot: verify_message.png');

  // Check page state
  const state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    hasLogin: !!document.querySelector('#email'),
    bodyText: document.body?.innerText?.substring(0, 500)
  }));

  console.log(`\nPage URL: ${state.url}`);
  console.log(`Title: ${state.title}`);
  console.log(`Login: ${state.hasLogin}`);
  console.log(`\nBody text:\n${state.bodyText}`);

  // Check if message was sent
  const hasMessage = state.bodyText?.includes('Hello from XActions!') || state.bodyText?.includes('xactions.app');
  console.log(`\n✅ Message found: ${hasMessage}`);

  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
}

verifyMessage().catch(console.error);
