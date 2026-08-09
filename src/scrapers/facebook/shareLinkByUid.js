// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - send a post to a user by their Facebook UID.
 * Flow: Navigate to profile by UID → Click Message → Send post link with message
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';

/**
 * Share a post to a user by UID via profile page.
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
  const { delay = () => new Promise(r => setTimeout(r, 1000)) } = options;

  if (!uid || !postUrl) {
    return { ok: false, uid: uid || '(unknown)', error: 'Missing uid or postUrl' };
  }

  try {
    // Navigate to profile by UID
    const profileUrl = `https://www.facebook.com/profile.php?id=${uid}`;
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000, 8000);

    // Check if profile exists
    const profileExists = await page.evaluate(() => {
      const hasLogin = !!document.querySelector('#email');
      const hasContent = document.body?.innerText?.length > 200;
      return !hasLogin && hasContent;
    });

    if (!profileExists) {
      return { ok: false, uid, error: 'Profile not found or not accessible' };
    }

    // Find and click "Message" button on profile
    const messageClicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[role="button"], button, a')];
      const messageBtn = buttons.find(b => {
        const text = (b.textContent || '').toLowerCase().trim();
        return text === 'message' || text === 'nhắn tin' || text === 'send message';
      });
      if (messageBtn) {
        messageBtn.click();
        return true;
      }
      return false;
    });

    if (!messageClicked) {
      // Fallback: navigate directly to conversation
      await page.goto(`https://www.facebook.com/messages/t/${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(3000, 5000);
    }

    await delay(2000, 3000);

    // Find compose box
    let composeBox = await page.$('div[role="textbox"][contenteditable="true"]');

    if (!composeBox) {
      // Try clicking conversation in sidebar
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

    // Compose message with post link
    const fullMessage = message ? `${message}\n${postUrl}` : postUrl;

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
      return { ok: true, uid, sentVia: sent, method: 'profile-message' };
    }

    // Fallback: Enter key
    await page.keyboard.press('Enter');
    await delay(2000, 3000);
    return { ok: true, uid, sentVia: 'enter-fallback', method: 'profile-message' };
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
