// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - send a post to a user by their Facebook UID.
 * Ports C# Main.cs:Post() lines 582-799.
 *
 * Flow:
 * 1. GraphQL API (checkMessengerCTA) with UID as actor_id → verify eligibility
 * 2. Navigate to post → click share button
 * 3. Click ALL "via Messenger" buttons in dialog (shares to recent conversations)
 * 4. Send separate DM with message to the UID
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';
import { getFacebookTokens, checkMessengerCTA, buildCookieString } from './graphql.js';

/**
 * Click all "via Messenger" buttons in the share dialog.
 * @param {Object} page - Puppeteer page
 * @param {Function} delay - Delay function
 * @returns {Promise<{clicked: number, labels: string[]}>}
 */
async function clickAllMessengerButtons(page, delay = () => new Promise(r => setTimeout(r, 500))) {
  const clickedLabels = [];
  let totalClicked = 0;

  const result = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[role="button"][aria-label]')];
    const messengerBtns = buttons.filter(b => {
      const label = b.getAttribute('aria-label') || '';
      return /via Messenger|qua Messenger/i.test(label);
    });
    return {
      count: messengerBtns.length,
      labels: messengerBtns.map(b => b.getAttribute('aria-label'))
    };
  });

  for (const label of result.labels) {
    if (clickedLabels.includes(label)) continue; // Skip duplicates

    const clicked = await page.evaluate((targetLabel) => {
      const buttons = [...document.querySelectorAll('[role="button"][aria-label]')];
      const target = buttons.find(b => b.getAttribute('aria-label') === targetLabel);
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, label);

    if (clicked) {
      clickedLabels.push(label);
      totalClicked++;
      await delay(500, 1000);
    }
  }

  return { clicked: totalClicked, labels: clickedLabels };
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
  const { delay = () => new Promise(r => setTimeout(r, 1000)), cookie } = options;

  if (!uid || !postUrl) {
    return { ok: false, uid: uid || '(unknown)', error: 'Missing uid or postUrl' };
  }

  try {
    // Step 1: Check eligibility via GraphQL API (C# Main.cs:558-581)
    let eligible = false;
    if (cookie) {
      try {
        const tokens = await getFacebookTokens(buildCookieString(cookie));
        const cta = await checkMessengerCTA(uid, uid, tokens);
        eligible = cta.eligible;
      } catch {
        // If CTA check fails, proceed anyway (don't block the share)
        eligible = true;
      }
    }

    // Step 2: Navigate to post and click share button
    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000, 5000);

    const shareClicked = await page.evaluate(() => {
      const shareBtn = document.querySelector('div[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]');
      if (shareBtn) {
        const btn = shareBtn.closest('div[role="button"]') || shareBtn;
        btn.click();
        return true;
      }
      return false;
    });

    if (!shareClicked) {
      return { ok: false, uid, error: 'Share button not found' };
    }

    await delay(2000, 3000);

    // Step 3: Click ALL "via Messenger" buttons (C# Main.cs:635-695)
    const { clicked, labels } = await clickAllMessengerButtons(page, delay);

    // Step 4: Check for "More share options" and click more buttons
    const moreClicked = await page.evaluate(() => {
      const moreBtn = [...document.querySelectorAll('*')].find(el =>
        el.textContent.trim() === 'More share options' ||
        el.textContent.trim() === 'Thêm tùy chọn chia sẻ'
      );
      if (moreBtn) {
        moreBtn.click();
        return true;
      }
      return false;
    });

    if (moreClicked) {
      await delay(2000, 3000);
      await clickAllMessengerButtons(page, delay);
    }

    // Step 5: Send separate DM with message (C# Main.cs:744-799)
    if (message) {
      await sendDirectMessage(page, uid, message, delay);
    }

    return {
      ok: true,
      uid,
      method: 'share-dialog',
      sharesClicked: clicked,
      eligible,
    };
  } catch (err) {
    return { ok: false, uid, error: err.message };
  }
}

/**
 * Send a direct message to a UID via Messenger.
 * @param {Object} page - Puppeteer page
 * @param {string} uid - Facebook UID
 * @param {string} message - Message to send
 * @param {Function} delay - Delay function
 * @returns {Promise<{ok: boolean, sentVia?: string, error?: string}>}
 */
async function sendDirectMessage(page, uid, message, delay = () => new Promise(r => setTimeout(r, 500))) {
  await page.goto(`https://www.facebook.com/messages/t/${uid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(5000, 8000);

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
    return { ok: false, error: 'Compose box not found' };
  }

  await composeBox.click();
  await delay(300, 500);
  await page.keyboard.type(message, { delay: 20 + Math.random() * 30 });
  await delay(500, 1000);

  // Click send button (appears after typing)
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

  await page.keyboard.press('Enter');
  await delay(2000, 3000);
  return { ok: true, sentVia: 'enter-fallback' };
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
