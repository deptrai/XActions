// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - send a link to a user by their Facebook UID.
 * Ports the C# tool feature: navigate to conversation by UID, type link, send.
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';

// Selectors for the Messenger conversation page
const SELECTORS = {
  // Conversation thread rows in the sidebar
  threadLink: 'a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]',
  // Compose box in the conversation
  composeBox: '[role="textbox"][contenteditable="true"]',
  // Send button
  sendButtonNeedles: ['send', 'gửi', 'nhấn enter', 'press enter'],
};

/**
 * Navigate to a conversation by UID and click it in the sidebar.
 * @param {Object} page - Puppeteer page
 * @param {string} uid - Facebook UID
 * @returns {Promise<boolean>} True if conversation was opened
 */
async function openConversationByUid(page, uid) {
  const conversationUrl = `https://www.facebook.com/messages/t/${uid}`;
  await page.goto(conversationUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check if compose box is already visible
  const hasComposeBox = await page.$('div[role="textbox"][contenteditable="true"]');
  if (hasComposeBox) return true;

  // Click the conversation in the sidebar
  const clicked = await page.evaluate((targetUid) => {
    const links = [...document.querySelectorAll('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]')];
    // Try to find the conversation with matching UID
    const target = links.find(a => a.href.includes(targetUid) || a.getAttribute('href')?.includes(targetUid));
    if (target) {
      target.click();
      return true;
    }
    // If not found, try any conversation (the page may have auto-selected it)
    if (links.length > 0) {
      links[0].click();
      return true;
    }
    return false;
  }, uid);

  if (!clicked) return false;

  await new Promise(r => setTimeout(r, 3000));
  return !!(await page.$('div[role="textbox"][contenteditable="true"]'));
}

/**
 * Type text into the compose box and send.
 * @param {Object} page - Puppeteer page
 * @param {string} text - Text to send
 * @param {Function} delay - Delay function
 * @returns {Promise<{ok: boolean, sentVia?: string}>}
 */
async function typeAndSend(page, text, delay = () => new Promise(r => setTimeout(r, 500))) {
  const composeBox = await page.$('div[role="textbox"][contenteditable="true"]');
  if (!composeBox) return { ok: false, error: 'Compose box not found' };

  await composeBox.click();
  await delay(300, 600);

  // Type the text
  await page.keyboard.type(text, { delay: 20 + Math.random() * 30 });
  await delay(500, 1000);

  // Find and click the send button
  const sent = await page.evaluate((needles) => {
    const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
    const sendBtn = btns.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return needles.some(n => label.includes(n));
    });
    if (sendBtn) {
      sendBtn.click();
      return sendBtn.getAttribute('aria-label');
    }
    return null;
  }, ['send', 'gửi', 'nhấn enter', 'press enter']);

  if (sent) {
    return { ok: true, sentVia: sent };
  }

  // Fallback: press Enter
  await page.keyboard.press('Enter');
  return { ok: true, sentVia: 'enter-fallback' };
}

/**
 * Share a link to a user by UID.
 * @param {Object} page - Puppeteer page (logged in)
 * @param {Object} target - Share target
 * @param {string} target.uid - Facebook UID to send to
 * @param {string} target.link - Link to send
 * @param {string} [target.message] - Optional message before the link
 * @param {Object} [options]
 * @returns {Promise<{ok: boolean, uid: string, error?: string}>}
 */
export async function shareLinkByUid(page, target, options = {}) {
  const { uid, link, message } = target;
  const { delay = () => new Promise(r => setTimeout(r, 1000)) } = options;

  if (!uid || !link) {
    return { ok: false, uid: uid || '(unknown)', error: 'Missing uid or link' };
  }

  try {
    // Open conversation by UID
    const opened = await openConversationByUid(page, uid);
    if (!opened) {
      return { ok: false, uid, error: 'Conversation not found or not accessible' };
    }

    // Compose message: optional message + link
    const fullText = message ? `${message}\n${link}` : link;

    // Type and send
    const result = await typeAndSend(page, fullText, delay);
    return { ok: result.ok, uid, sentVia: result.sentVia, error: result.error };
  } catch (err) {
    return { ok: false, uid, error: err.message };
  }
}

/**
 * Batch share links to multiple UIDs.
 * @param {Object} page - Puppeteer page
 * @param {Object} campaign
 * @param {string[]} campaign.uids - Array of Facebook UIDs
 * @param {string} campaign.link - Link to send
 * @param {string} [campaign.message] - Optional message
 * @param {Object} [options]
 * @returns {Promise<Object>} runGuardedBatch result
 */
export async function shareLinkByUidCampaign(page, campaign, options = {}) {
  const { uids, link, message } = campaign;

  if (!link) throw new Error('❌ shareLinkByUidCampaign: link is required');
  if (!Array.isArray(uids) || uids.length === 0) {
    throw new Error('❌ shareLinkByUidCampaign: uids must be a non-empty array');
  }

  const items = uids.map(uid => ({
    uid,
    link,
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

export default { shareLinkByUid, shareLinkByUidCampaign, openConversationByUid, typeAndSend };
