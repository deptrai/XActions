// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - send a post to a user by their Facebook UID.
 * Uses GraphQL MWChatBusinessCTAAdsSenderMutation (C# Main.cs:579-580).
 * This does NOT require an existing conversation.
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';
import { sendMessageToUid } from './graphql.js';

/**
 * Share a post to a user by UID via GraphQL API.
 * @param {Object} page - Puppeteer page (logged in)
 * @param {Object} target - Share target
 * @param {string} target.uid - Facebook UID to share to
 * @param {string} target.postUrl - URL of the post to share
 * @param {string} [target.message] - Message to send with the share
 * @param {Object} [options]
 * @returns {Promise<{ok: boolean, uid: string, error?: string, method?: string}>}
 */
export async function shareLinkByUid(page, target, options = {}) {
  const { uid, postUrl, message } = target;
  const { delay = () => new Promise(r => setTimeout(r, 1000)), cookie } = options;

  if (!uid || !postUrl) {
    return { ok: false, uid: uid || '(unknown)', error: 'Missing uid or postUrl' };
  }

  try {
    // Method 1: GraphQL API (C# Main.cs:579-581) - no conversation needed
    // Navigate to Facebook to ensure we have tokens
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000, 5000);

    // Handle Facebook anti-bot "Continue" page
    const needsContinue = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"], button')];
      const continueBtn = btns.find(b => b.textContent.trim() === 'Continue');
      if (continueBtn) {
        continueBtn.click();
        return true;
      }
      return false;
    });

    if (needsContinue) {
      await delay(3000, 5000);
    }

    const result = await sendMessageToUid(page, uid, message || postUrl);

    if (result.ok) {
      return { ok: true, uid, method: 'graphql-api', response: result.response };
    }

    // If GraphQL failed, fall through to profile method
    console.log(`⚠️ GraphQL failed: ${result.error}. Trying profile method...`);

    // Method 2: Profile page + Messenger (fallback)
    await page.goto(`https://www.facebook.com/profile.php?id=${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000, 8000);

    // Find and click "Message" button
    const messageClicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[role="button"], button')];
      const messageBtn = buttons.find(b => {
        const text = (b.textContent || '').toLowerCase().trim();
        return text === 'message' || text === 'nhắn tin';
      });
      if (messageBtn) {
        messageBtn.click();
        return true;
      }
      return false;
    });

    if (!messageClicked) {
      // Navigate directly to conversation
      await page.goto(`https://www.facebook.com/messages/t/${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(3000, 5000);
    } else {
      await delay(2000, 3000);
    }

    // Find compose box
    let composeBox = await page.$('div[role="textbox"][contenteditable="true"]');

    if (!composeBox) {
      await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href*="/messages/t/"]')];
        if (links.length > 0) links[0].click();
      });
      await delay(3000, 5000);
      composeBox = await page.$('div[role="textbox"][contenteditable="true"]');
    }

    if (!composeBox) {
      return { ok: false, uid, error: 'Compose box not found' };
    }

    // Type message
    await composeBox.click();
    await delay(300, 500);
    await page.keyboard.type(fullMessage, { delay: 20 + Math.random() * 30 });
    await delay(500, 1000);

    // Send
    const sent = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
      const sendBtn = btns.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase().trim();
        return label === 'press enter to send' || label === 'nhấn enter để gửi'
          || label === 'send' || label === 'gửi';
      });
      if (sendBtn) {
        sendBtn.click();
        return sendBtn.getAttribute('aria-label');
      }
      return null;
    });

    if (sent) {
      await delay(2000, 3000);
      return { ok: true, uid, sentVia: sent, method: 'profile-messenger' };
    }

    await page.keyboard.press('Enter');
    await delay(2000, 3000);
    return { ok: true, uid, sentVia: 'enter-fallback', method: 'profile-messenger' };
  } catch (err) {
    return { ok: false, uid, error: err.message };
  }
}

/**
 * Batch share links to multiple UIDs.
 * @param {Object} page - Puppeteer page
 * @param {Object} campaign
 * @param {string[]} campaign.uids - Array of Facebook UIDs
 * @param {string} campaign.postUrl - URL of the post to share
 * @param {string} [campaign.message] - Optional message
 * @param {Object} [options]
 * @returns {Promise<Object>} runGuardedBatch result
 */
export async function shareLinkByUidCampaign(page, campaign, options = {}) {
  const { uids, postUrl, message } = campaign;

  if (!postUrl) throw new Error('❌ shareLinkByUidCampaign: postUrl is required');
  if (!Array.isArray(uids) || uids.length === 0) {
    throw new Error('❌ shareLinkByUidCampaign: uids must be a non-empty array');
  }

  const items = uids.map(uid => ({
    uid,
    postUrl,
    message,
    toString: () => uid,
  }));

  const actionFn = async (target) => {
    const result = await shareLinkByUid(page, target, options);
    return result;
  };

  return runGuardedBatch(items, actionFn, {
    ...options,
    delay: options.delay || ((min = 3000, max = 8000) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)))),
  });
}

export default { shareLinkByUid, shareLinkByUidCampaign };
