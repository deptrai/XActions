import puppeteer from 'puppeteer';
import { loginWithCookie, createBrowser, createPage } from './src/scrapers/facebook/index.js';

const COOKIE = {
  c_user: '61590064244856',
  xs: '48%3A-vxiobBZqf3qVQ:2:1786302115:-1:-1:AcxCuIvg82bSik27c5UBYcqMWadR16R1io8rqPx7jA',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1lgJkVvrPzA8p8LGQ.AWdsuIWLLIDmfqFgC_gTaLiKx0ACpoBSC10G6IwuRsmhsuDmcLQ.BqeM6t..AAA.0.0.BqeM6t.AWeWGCL3U7d0SO2KRvvi56lNPwE'
};

async function verifyMessage() {
  const browser = await createBrowser({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await createPage(browser);

  await loginWithCookie(page, COOKIE);
  console.log('✅ Logged in');

  // Navigate to the conversation
  const uid = '284871858534684';
  console.log(`\nNavigating to conversation with UID: ${uid}`);
  await page.goto(`https://www.facebook.com/messages/t/${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Check page content
  const state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText?.substring(0, 600)
  }));

  console.log(`\nPage URL: ${state.url}`);
  console.log(`Title: ${state.title}`);
  console.log(`\nBody text:\n${state.bodyText}`);

  // Check if message was sent
  const hasMessage = state.bodyText?.includes('Hello from XActions!') || state.bodyText?.includes('xactions.app');
  console.log(`\n✅ Message found: ${hasMessage}`);

  // Take screenshot
  await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/verify_final.png' });
  console.log('📸 Screenshot: verify_final.png');

  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
}

verifyMessage().catch(console.error);
