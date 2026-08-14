#!/usr/bin/env node
/**
 * Facebook Share via Messenger
 * Sends post URL to recipients using Facebook Messenger
 *
 * Usage:
 *   node fb-share.mjs --post="URL" --recipients="uid1,uid2,uid3"
 *
 * Features:
 * - Uses 8 working Facebook accounts
 * - Sends post URL via direct Messenger
 * - Rotates accounts to avoid rate limits
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Working accounts
const ACCOUNTS = [
  { uid: '61551532654077', cookie: 'c_user=61551532654077;xs=36:S-jWTjZkyhJFPA:2:1786256246:-1:-1;oo=v1%7C3:1786256245;datr=hvlpaq9byAlvhl67oieOPTwH;' },
  { uid: '61559519003000', cookie: 'c_user=61559519003000;xs=7:f00TTOqNez43kg:2:1786256248:-1:-1;oo=v1%7C3:1786256248;datr=GQlqai3ZP7-MkMTu3znEldj-;' },
  { uid: '61559273867716', cookie: 'c_user=61559273867716;xs=13:73GhLVcs3NEbJA:2:1786256252:-1:-1;oo=v1%7C3:1786256251;datr=-N9sasfkoPrPvpAeUirHjnrs;' },
  { uid: '100095166129041', cookie: 'c_user=100095166129041;xs=3:NAqbw5r9kOlO2Q:2:1786256260:-1:-1;oo=v1%7C3:1786256259;datr=YPlpaq-Z7sNJ52j2_GubP0YL;' },
  { uid: '100054352380630', cookie: 'c_user=100054352380630;xs=33:N-KiJnf77Qefmg:2:1786256260:-1:-1;oo=v1%7C3:1786256259;datr=fPppaojcU4_IT4cfmpppcqw0;' },
  { uid: '100092936258699', cookie: 'c_user=100092936258699;xs=38:PUjxlddGC97T_A:2:1786256263:-1:-1;oo=v1%7C3:1786256262;datr=CvhpasVo2Zh6WmU9pRbNw0UX;' },
  { uid: '100085428323192', cookie: 'c_user=100085428323192;xs=42:Gh_mwDFDlwgBQQ:2:1786256280:-1:-1;oo=v1%7C3:1786256280;datr=MRlqauJ4fYjZYosAOTyZEL44;' },
  { uid: '100093227282603', cookie: 'c_user=100093227282603;xs=11:Jhk6jlWHYh5Zfg:2:1786256282:-1:-1;oo=v1%7C3:1786256281;datr=nRdqamM1O7tLeZT_WY_h2t13;' },
];

async function sendViaMessenger(account, recipientUid, postUrl) {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  try {
    // Set cookies
    const cookies = account.cookie.split(';').filter(c => c.includes('=')).map(c => {
      const [name, ...v] = c.trim().split('=');
      return { name: name.trim(), value: v.join('=').trim(), domain: '.facebook.com', path: '/' };
    });
    await page.setCookie(...cookies);

    // Navigate to Messenger with recipient
    await page.goto(`https://www.facebook.com/messages/t/${recipientUid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(8000);

    // Check if correct conversation opened
    const conversation = await page.evaluate(() => {
      const editor = document.querySelector('[contenteditable="true"]');
      const ariaLabel = editor?.getAttribute('aria-label') || '';
      return { ariaLabel, hasEditor: !!editor };
    });

    if (!conversation.hasEditor) {
      console.log(`    ❌ No message input found`);
      await browser.close();
      return false;
    }

    // Paste URL using clipboard
    await page.evaluate(async (url) => {
      const editor = document.querySelector('[contenteditable="true"]');
      if (editor) {
        editor.focus();
        try {
          await navigator.clipboard.writeText(url);
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', url);
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboardData
        });
        editor.dispatchEvent(pasteEvent);
      }
    }, postUrl);

    await delay(2000);

    // Press Enter to send
    await page.keyboard.press('Enter');
    await delay(2000);

    // Verify sent
    const sent = await page.evaluate(() => {
      const text = document.body?.innerText;
      return text?.includes('You:') || text?.__fb_light_mode?.includes('You:') || false;
    });

    await browser.close();
    return true;

  } catch (error) {
    console.log(`    ❌ Error: ${error.message}`);
    await browser.close();
    return false;
  }
}

async function sharePost(postUrl, recipientUids) {
  console.log('=== Facebook Share via Messenger ===\n');
  console.log(`Post: ${postUrl}`);
  console.log(`Recipients: ${recipientUids.length} users\n`);

  const results = [];
  let accountIndex = 0;

  for (const recipientUid of recipientUids) {
    const account = ACCOUNTS[accountIndex % ACCOUNTS.length];
    console.log(`[${results.length + 1}/${recipientUids.length}] Sending to ${recipientUid} via account ${account.uid}...`);

    const ok = await sendViaMessenger(account, recipientUid, postUrl);
    results.push({ uid: recipientUid, ok, account: account.uid });
    console.log(`    ${ok ? '✅ Sent' : '❌ Failed'}`);

    // Rotate accounts and add delay
    accountIndex++;
    await delay(3000 + Math.random() * 2000);
  }

  const successCount = results.filter(r => r.ok).length;
  console.log(`\n=== Results: ${successCount}/${results.length} sent successfully ===`);

  return results;
}

// Parse arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};

const postUrl = getArg('post');
const recipientsArg = getArg('recipients');

if (!postUrl || !recipientsArg) {
  console.log('Usage: node fb-share.mjs --post="<URL>" --recipients="uid1,uid2,uid3"');
  console.log('');
  console.log('Example:');
  console.log('  node fb-share.mjs --post="https://www.facebook.com/groups/opensource/posts/2058028564788480" --recipients="1172593649275563,123456789"');
  process.exit(1);
}

const recipientUids = recipientsArg.split(',').map(s => s.trim()).filter(Boolean);

sharePost(postUrl, recipientUids).catch(console.error);
