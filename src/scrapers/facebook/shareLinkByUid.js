// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - send a post to a user by their Facebook UID.
 * Flow: Navigate to post → Click share → Search UID in dialog → Select recipient → Send DM
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';

// Selectors for the share dialog
const SELECTORS = {
  // Share button on a post
  shareButton: 'div[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]',
  shareButtonXPath: '//div[@data-ad-rendering-role="share_button"]/..',
  // Search input in the share dialog
  searchInput: 'input[placeholder*="Search"]',
  // Recipient buttons in the share dialog
  recipientButtons: 'div[role="button"][aria-label*="via Messenger"], div[role="button"][aria-label*="qua Messenger"]',
  // DM compose box (for sending separate message)
  composeBox: 'div[role="textbox"][contenteditable="true"]',
  // Send button
  sendButtonNeedles: ['press enter to send', 'nhấn enter để gửi', 'send', 'gửi'],
  // Conversation thread link
  threadLink: 'a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]',
};

/**
 * Click the share button on a post.
 * @param {Object} page - Puppeteer page
 * @param {number} timeout - Max wait in ms
 * @returns {Promise<boolean>} True if share button was clicked
 */
async function clickShareButton(page, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const clicked = await page.evaluate(() => {
      const shareBtn = document.querySelector('div[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]');
      if (shareBtn) {
        const btn = shareBtn.closest('div[role="button"]') || shareBtn;
        btn.click();
        return true;
      }
      return false;
    });
    if (clicked) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Search for a UID in the share dialog's search box.
 * @param {Object} page - Puppeteer page
 * @param {string} uid - Facebook UID to search for
 * @param {Function} delay - Delay function
 * @returns {Promise<boolean>} True if search was performed
 */
async function searchUidInDialog(page, uid, delay = () => new Promise(r => setTimeout(r, 500))) {
  // Find the search input
  const searchInput = await page.$('input[placeholder*="Search"]');
  if (!searchInput) return false;

  // Clear and type the UID
  await searchInput.click();
  await delay(300, 500);
  await page.evaluate((el) => { el.value = ''; }, searchInput);
  await page.keyboard.type(uid, { delay: 30 + Math.random() * 20 });
  await delay(2000, 3000); // Wait for search results

  return true;
}

/**
 * Find and click a recipient by UID in the share dialog.
 * @param {Object} page - Puppeteer page
 * @param {string} uid - Facebook UID
 * @returns {Promise<string|null>} The clicked aria-label, or null if not found
 */
async function clickRecipientByUid(page, uid) {
  return page.evaluate((targetUid) => {
    const buttons = [...document.querySelectorAll('[role="button"][aria-label]')];
    // Find button where the associated profile link contains the UID
    const target = buttons.find((b) => {
      const label = b.getAttribute('aria-label') || '';
      if (!/via Messenger|qua Messenger/i.test(label)) return false;

      // Check if any parent or child link contains the UID
      const parent = b.closest('a[href*="profile.php?id=' + targetUid + '"], a[href*="/user/' + targetUid + '/"]');
      if (parent) return true;

      // Check siblings and children for links with UID
      const container = b.parentElement;
      if (container) {
        const links = container.querySelectorAll('a[href]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && (href.includes('profile.php?id=' + targetUid) || href.includes('/user/' + targetUid + '/'))) {
            return true;
          }
        }
      }
      return false;
    });

    if (target) {
      target.click();
      return target.getAttribute('aria-label');
    }
    return null;
  }, uid);
}

/**
 * Send a message to a UID via direct Messenger conversation.
 * Fallback when share dialog doesn't work.
 * @param {Object} page - Puppeteer page
 * @param {string} uid - Facebook UID
 * @param {string} message - Message to send
 * @param {Function} delay - Delay function
 * @returns {Promise<{ok: boolean, sentVia?: string, error?: string}>}
 */
async function sendDirectMessage(page, uid, message, delay = () => new Promise(r => setTimeout(r, 500))) {
  // Navigate to conversation
  await page.goto(`https://www.facebook.com/messages/t/${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(5000, 8000);

  // Check for compose box
  let composeBox = await page.$('div[role="textbox"][contenteditable="true"]');
  if (!composeBox) {
    // Try clicking the conversation in sidebar
    await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/messages/t/"]')];
      if (links.length > 0) links[0].click();
    });
    await delay(3000, 5000);
    composeBox = await page.$('div[role="textbox"][contenteditable="true"]');
  }

  if (!composeBox) {
    return { ok: false, error: 'Compose box not found' };
  }

  // Type message
  await composeBox.click();
  await delay(300, 500);
  await page.keyboard.type(message, { delay: 20 + Math.random() * 30 });
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
    return { ok: true, sentVia: sent };
  }

  // Fallback: Enter key
  await page.keyboard.press('Enter');
  await delay(2000, 3000);
  return { ok: true, sentVia: 'enter-fallback' };
}

/**
 * Share a post to a user by UID via the share dialog.
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
    // Method 1: Try share dialog with UID search
    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000, 5000);

    // Click share button
    const shareClicked = await clickShareButton(page, 8000);
    if (!shareClicked) {
      // Fallback: send direct message
      const result = await sendDirectMessage(page, uid, message || postUrl, delay);
      return { ...result, uid, method: 'direct-message' };
    }

    await delay(2000, 3000);

    // Search for UID in dialog
    await searchUidInDialog(page, uid, delay);

    // Try to find and click recipient
    const clickedLabel = await clickRecipientByUid(page, uid);
    if (clickedLabel) {
      await delay(2000, 3000);
      // Send separate DM if message provided
      if (message) {
        await sendDirectMessage(page, uid, message, delay);
      }
      return { ok: true, uid, method: 'share-dialog', clickedLabel };
    }

    // Method 2: Fallback to direct message
    const result = await sendDirectMessage(page, uid, message || postUrl, delay);
    return { ...result, uid, method: 'direct-message' };
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

export default { shareLinkByUid, shareLinkByUidCampaign, sendDirectMessage };
