#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Local Facebook Share Tool - Kết nối đến Chrome có sẵn
 *
 * Bước 1: Mở Chrome với remote debugging:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *
 * Bước 2: Login Facebook trong Chrome đó
 *
 * Bước 3: Chạy tool:
 *   node local-share-cdp.mjs --postUrl="https://..." --message="Hello!" --recipients="uid1,uid2"
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { program } from 'commander';

chromium.use(StealthPlugin());

program
  .option('--postUrl <url>', 'URL của post cần share')
  .option('--message <text>', 'Tin nhắn kèm theo', '')
  .option('--recipients <uids>', 'Danh sách UID (phân cách dấu phẩy)')
  .option('--cdpPort <port>', 'CDP port', '9222')
  .option('--cookies <json>', 'Facebook cookies as JSON string', '')
  .parse();

const opts = program.opts();

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sharePost({ postUrl, message, recipients, cdpPort, cookies }) {
  console.log('=== Facebook Local Share Tool (CDP) ===\n');

  // Connect to existing Chrome
  console.log(`[1] Kết nối đến Chrome port ${cdpPort}...`);
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  console.log('    ✅ Đã kết nối');

  // Add cookies if provided
  if (cookies) {
    console.log('\n[2] Thêm cookies...');
    let cookieData;
    try {
      cookieData = JSON.parse(cookies);
    } catch (e) {
      console.log('    ❌ Cookies JSON không hợp lệ');
      await browser.close();
      return { ok: false, error: 'Invalid cookies JSON' };
    }

    const cookieObjects = Object.entries(cookieData).map(([name, value]) => ({
      name,
      value: String(value),
      domain: '.facebook.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'None'
    }));

    await context.addCookies(cookieObjects);
    console.log(`    ✅ Đã thêm ${cookieObjects.length} cookies`);
  }

  // Check login
  console.log('\n[3] Kiểm tra login...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(3000);

  const isLoggedIn = await page.evaluate(() => !document.querySelector('#email'));
  console.log(`    Đã login: ${isLoggedIn}`);

  if (!isLoggedIn) {
    console.log('    ❌ Chưa login. Hãy login Facebook trong Chrome trước.');
    await browser.close();
    return { ok: false, error: 'Not logged in' };
  }

  // Navigate to post
  console.log('\n[3] Đi đến bài viết...');
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(5000);

  // Click share button
  console.log('[4] Click nút Share...');
  const shareClicked = await page.evaluate(() => {
    const shareBtn = document.querySelector('[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]');
    if (shareBtn) {
      (shareBtn.closest('[role="button"]') || shareBtn).click();
      return true;
    }
    return false;
  });

  if (!shareClicked) {
    console.log('    ❌ Không tìm thấy nút Share');
    await browser.close();
    return { ok: false, error: 'Share button not found' };
  }

  await delay(3000);

  // Share to each recipient
  console.log('\n[5] Share đến từng người...');
  const results = [];

  for (const uid of recipients.split(',')) {
    const trimmedUid = uid.trim();
    console.log(`\n    Gửi đến UID: ${trimmedUid}...`);

    // Click Messenger button
    const messengerClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
      const messengerBtn = btns.find(b => /via Messenger|qua Messenger/i.test(b.getAttribute('aria-label') || ''));
      if (messengerBtn) {
        messengerBtn.click();
        return true;
      }
      return false;
    });

    if (!messengerClicked) {
      console.log('      ❌ Không tìm thấy nút Messenger');
      results.push({ uid: trimmedUid, ok: false, error: 'Messenger button not found' });
      continue;
    }

    await delay(2000);

    // Type message
    if (message) {
      const typed = await page.evaluate(async (msg) => {
        const composer = document.querySelector('[contenteditable="true"]');
        if (composer) {
          composer.focus();
          composer.textContent = msg;
          composer.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        return false;
      }, message);

      console.log(`      Đã nhập tin nhắn: ${typed ? '✅' : '❌'}`);
      await delay(1000);
    }

    // Click Send
    const sent = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"], button')];
      const sendBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'send');
      if (sendBtn) {
        sendBtn.click();
        return true;
      }
      return false;
    });

    console.log(`      Đã click Send: ${sent ? '✅' : '❌'}`);
    results.push({ uid: trimmedUid, ok: sent });

    await delay(2000);
  }

  await browser.close();

  const successCount = results.filter(r => r.ok).length;
  console.log(`\n=== Kết quả: ${successCount}/${results.length} đã gửi ===`);

  return { ok: successCount > 0, results };
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!opts.postUrl || !opts.recipients) {
    console.log('Cách dùng:');
    console.log('  1. Mở Chrome với: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    console.log('  2. Login Facebook trong Chrome');
    console.log('  3. Chạy: node local-share-cdp.mjs --postUrl="https://..." --message="Hello!" --recipients="uid1,uid2"');
    process.exit(1);
  }

  sharePost({
    postUrl: opts.postUrl,
    message: opts.message,
    recipients: opts.recipients,
    cdpPort: opts.cdpPort
  }).catch(err => {
    console.error('Lỗi:', err.message);
    process.exit(1);
  });
}

export { sharePost };
