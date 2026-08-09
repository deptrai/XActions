import puppeteer from 'puppeteer';
import { loginWithCookie, createBrowser, createPage } from './src/scrapers/facebook/index.js';

const COOKIE = {
  c_user: '61590064244856',
  xs: '48%3A-vxiobBZqf3qVQ%3A2%3A1786302115%3A-1%3A-1%3A%3AAcxCuIvg82bSik27c5UBYcqMWadR16R1io8rqPx7jA',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1lgJkVvrPzA8p8LGQ.AWdsuIWLLIDmfqFgC_gTaLiKx0ACpoBSC10G6IwuRsmhsuDmcLQ.BqeM6t..AAA.0.0.BqeM6t.AWeWGCL3U7d0SO2KRvvi56lNPwE'
};

async function debugShareUid() {
  const browser = await createBrowser({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await createPage(browser);

  await loginWithCookie(page, COOKIE);
  console.log('✅ Logged in');

  const testUid = '100000123456789';

  console.log(`\n=== Debug: Share link to UID ${testUid} ===`);

  // Navigate to conversation
  const conversationUrl = `https://www.facebook.com/messages/t/${testUid}`;
  console.log(`[1] Navigating to: ${conversationUrl}`);
  await page.goto(conversationUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Check page state
  let state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    hasLogin: !!document.querySelector('#email'),
    hasComposeBox: !!document.querySelector('[role="textbox"][contenteditable="true"]'),
    bodyPreview: document.body?.innerText?.substring(0, 500)
  }));

  console.log(`    URL: ${state.url}`);
  console.log(`    Title: ${state.title}`);
  console.log(`    Compose box: ${state.hasComposeBox}`);
  console.log(`    Body: ${state.bodyPreview?.substring(0, 200)}`);

  // Take screenshot
  await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/debug_uid_1.png' });
  console.log('    Screenshot saved: debug_uid_1.png');

  if (!state.hasComposeBox) {
    console.log('\n[2] Compose box not found, looking for conversation in sidebar...');

    // Check sidebar for conversations
    const sidebarInfo = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/messages/t/"]')];
      return {
        count: links.length,
        firstFew: links.slice(0, 5).map(a => ({
          href: a.getAttribute('href'),
          text: a.innerText?.substring(0, 50)
        }))
      };
    });

    console.log(`    Sidebar conversations: ${sidebarInfo.count}`);
    sidebarInfo.firstFew.forEach((link, i) => {
      console.log(`      [${i}] ${link.href}: ${link.text}`);
    });

    // Try clicking the first conversation
    if (sidebarInfo.count > 0) {
      console.log('\n[3] Clicking first conversation in sidebar...');
      await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href*="/messages/t/"]')];
        if (links.length > 0) links[0].click();
      });
      await new Promise(r => setTimeout(r, 5000));

      state = await page.evaluate(() => ({
        url: window.location.href,
        hasComposeBox: !!document.querySelector('[role="textbox"][contenteditable="true"]')
      }));

      console.log(`    After click - Compose box: ${state.hasComposeBox}`);
      await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/debug_uid_2.png' });
    }
  }

  // If we have compose box, try typing
  if (state.hasComposeBox) {
    console.log('\n[4] Typing message into compose box...');
    const composeBox = await page.$('[role="textbox"][contenteditable="true"]');
    await composeBox.click();
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.type('Test message via UID', { delay: 30 + Math.random() * 20 });
    await new Promise(r => setTimeout(r, 1000));

    await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/debug_uid_3.png' });

    // Check for send button
    const sendBtnInfo = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
      return btns.map(b => b.getAttribute('aria-label')).filter(l => l);
    });

    console.log(`    Send buttons found: ${sendBtnInfo.length}`);
    sendBtnInfo.forEach((label, i) => console.log(`      [${i}] ${label}`));

    // Try to send
    const sent = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
      const sendBtn = btns.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase().trim();
        return label === 'send' || label === 'gửi' || label === 'press enter to send' || label === 'nhấn enter để gửi';
      });
      if (sendBtn) {
        sendBtn.click();
        return sendBtn.getAttribute('aria-label');
      }
      return null;
    });

    if (sent) {
      console.log(`[5] Message sent via: ${sent}`);
    } else {
      console.log('[5] Send button not found, trying Enter...');
      await page.keyboard.press('Enter');
    }

    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: '/Users/luisphan/Documents/GitHub/XActions/debug_uid_4.png' });
  }

  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
  console.log('\n=== Debug complete ===');
}

debugShareUid().catch(console.error);
