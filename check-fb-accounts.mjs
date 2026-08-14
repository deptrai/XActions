#!/usr/bin/env node
/**
 * Quick Facebook cookie checker — prints live/dead accounts.
 */

import { createBrowser, createPage, loginWithCookie } from './src/scrapers/facebook/index.js';

const ACCOUNTS = [
  { c_user: '61590575447989', xs: '46:r9uvnqprx7fcPw:2:1786466771:-1:-1', datr: 'ENIyav8qTIpgCAlKvrH90i-H' },
  { c_user: '61590556597397', xs: '20:HdmjbzYZRVO2ZA:2:1786453467:-1:-1', datr: 'ercoaosL5SmmYxHwLUjYBCmP' },
  { c_user: '61590557227260', xs: '49:tZBA0I2Cgxbz3w:2:1786475971:-1:-1', datr: 'jLcoak3SSuSHUXgVfZjBy236' },
  { c_user: '61590586566607', xs: '33:GecSQdbofARUDQ:2:1786466827:-1:-1', datr: 'oLEpapFcvsUXmfLR11AiYJUG' },
  { c_user: '61590564257168', xs: '18:APrxgZMyM-1UwA:2:1786466773:-1:-1', datr: 'xVMyasK_vMKsw5VVQKYQhKDe' },
  { c_user: '61590577116318', xs: '10:59pMl_22dx8P1g:2:1786466772:-1:-1', datr: 'Y0QoanJ71XdGKTvfyt5gbuJz' },
  { c_user: '61590511331025', xs: '1:7VoDI7R0ZAhAfg:2:1786453502:-1:-1', datr: 'OrArasJaCxyKVR7Ef_72XAf0' },
  { c_user: '61590453042697', xs: '10:rrcecaQXRr7hXA:2:1786475969:-1:-1', datr: 'GIcpartXTMbTaJVZuFlyMAKt' },
];

async function main() {
  const browser = await createBrowser({ headless: false });
  try {
    const live = [];
    const dead = [];

    for (const account of ACCOUNTS) {
      let page;
      try {
        page = await createPage(browser);
        await loginWithCookie(page, account);
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        const title = await page.title();
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || '');
        const isCheckpoint = /confirm this is your account|we locked your account/i.test(bodyText);
        const isLoginWall = /log in|sign up/i.test(title) || /log in to facebook|sign up/i.test(bodyText);

        if (!isLoginWall && !isCheckpoint) {
          console.log(`✅ LIVE  ${account.c_user} — "${title}"`);
          live.push(account);
        } else if (isCheckpoint) {
          console.log(`❌ CHECK ${account.c_user} — checkpointed`);
          dead.push(account);
        } else {
          console.log(`❌ LOGIN ${account.c_user} — login wall`);
          dead.push(account);
        }
      } catch (err) {
        console.log(`❌ ERROR ${account.c_user} — ${err.message}`);
        dead.push(account);
      } finally {
        if (page) await page.close();
      }
    }

    console.log('\n=== LIVE ===');
    live.forEach(a => console.log(JSON.stringify(a)));
    console.log('\n=== DEAD ===');
    dead.forEach(a => console.log(a.c_user));
    console.log(`\nLive: ${live.length}/${ACCOUNTS.length}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
