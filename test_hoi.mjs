import puppeteer from 'puppeteer';
import { loginWithCookie, createBrowser, createPage } from './src/scrapers/facebook/index.js';

// Hoi account cookie
const COOKIE = {
  c_user: '61590064244856',
  xs: '36%3AqI-IugaHc8Banw%3A2%3A1786333693%3A-1%3A-1%3A%3AAcyVi7Zj44320dtXuxytXcsjeRQZnWml2fYh8qHT6w',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1l9B1TVKb8KNftISg.AWdeNAQ1vOdA4FI26_Z7Au3DdE0yFJroHT_56gscE-bob4M-AF8.BqeUoA..AAA.0.0.BqeUoA.AWcSMOEU-bYhOSS63iCbYYJs9Ww'
};

async function testCookie() {
  const browser = await createBrowser({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await createPage(browser);

  // Navigate to Facebook
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Set cookies
  console.log('[1] Setting cookies...');
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

  // Navigate to Facebook
  console.log('[2] Navigating to Facebook...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check page state
  const state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    hasLogin: !!document.querySelector('#email'),
    hasFeed: !!document.querySelector('[role="feed"]'),
    bodyPreview: document.body?.innerText?.substring(0, 150)
  }));

  console.log(`\n[3] Page state:`);
  console.log(`    URL: ${state.url}`);
  console.log(`    Title: ${state.title}`);
  console.log(`    Login: ${state.hasLogin}`);
  console.log(`    Feed: ${state.hasFeed}`);
  console.log(`    Body: ${state.bodyPreview}`);

  const isAlive = !state.hasLogin && !state.bodyPreview?.includes('Explore the things you love');
  console.log(`\n✅ Account ALIVE: ${isAlive}`);

  if (isAlive && state.hasFeed) {
    // Test share dialog
    console.log('\n[4] Testing share dialog...');
    await page.goto('https://www.facebook.com/groups/opensource/posts/2058028564788480', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    const postState = await page.evaluate(() => ({
      hasShareBtn: !!document.querySelector('div[data-ad-rendering-role="share_button"]'),
      bodyPreview: document.body?.innerText?.substring(0, 100)
    }));

    console.log(`    Share button: ${postState.hasShareBtn}`);
    console.log(`    Body: ${postState.bodyPreview}`);

    if (postState.hasShareBtn) {
      // Click share
      await page.evaluate(() => {
        const shareBtn = document.querySelector('div[data-ad-rendering-role="share_button"]');
        if (shareBtn) {
          const btn = shareBtn.closest('div[role="button"]') || shareBtn;
          btn.click();
        }
      });
      await new Promise(r => setTimeout(r, 3000));

      // Check for Messenger buttons
      const dialogState = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
        const messengerBtns = btns.filter(b => /via Messenger|qua Messenger/i.test(b.getAttribute('aria-label') || ''));
        return {
          messengerCount: messengerBtns.length,
          labels: messengerBtns.slice(0, 5).map(b => b.getAttribute('aria-label'))
        };
      });

      console.log(`    Messenger buttons: ${dialogState.messengerCount}`);
      dialogState.labels.forEach((l, i) => console.log(`      [${i}] ${l}`));
    }
  }

  // Test share dialog
  console.log('\n[4] Testing share dialog...');
  await page.goto('https://www.facebook.com/groups/opensource/posts/2058028564788480', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const postState = await page.evaluate(() => ({
    hasShareBtn: !!document.querySelector('div[data-ad-rendering-role="share_button"]'),
    bodyPreview: document.body?.innerText?.substring(0, 100)
  }));

  console.log(`    Share button: ${postState.hasShareBtn}`);
  console.log(`    Body: ${postState.bodyPreview}`);

  if (postState.hasShareBtn) {
    // Click share
    await page.evaluate(() => {
      const shareBtn = document.querySelector('div[data-ad-rendering-role="share_button"]');
      if (shareBtn) {
        const btn = shareBtn.closest('div[role="button"]') || shareBtn;
        btn.click();
      }
    });
    await new Promise(r => setTimeout(r, 3000));

    // Check for Messenger buttons
    const dialogState = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
      const messengerBtns = btns.filter(b => /via Messenger|qua Messenger/i.test(b.getAttribute('aria-label') || ''));
      return {
        messengerCount: messengerBtns.length,
        labels: messengerBtns.slice(0, 5).map(b => b.getAttribute('aria-label'))
      };
    });

    console.log(`    Messenger buttons: ${dialogState.messengerCount}`);
    dialogState.labels.forEach((l, i) => console.log(`      [${i}] ${l}`));

    // Click all Messenger buttons
    if (dialogState.messengerCount > 0) {
      console.log('\n[5] Clicking all Messenger buttons...');
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
        const messengerBtns = btns.filter(b => /via Messenger|qua Messenger/i.test(b.getAttribute('aria-label') || ''));
        messengerBtns.forEach(b => b.click());
      });
      await new Promise(r => setTimeout(r, 3000));
      console.log('    Clicked all Messenger buttons');
    }
  } else {
    console.log('    ❌ Share button not found');
  }

  await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/debug_hoi.png' });
  console.log('\n📸 Screenshot: debug_hoi.png');

  await browser.close();
}

testCookie().catch(console.error);
