// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - Share dialog approach.
 * Navigate to post → Click share → Click ALL "via Messenger" buttons.
 * This sends to all recent conversations.
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';

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
    const messengerBtns = buttons.filter(b => /via Messenger|qua Messenger/i.test(b.getAttribute('aria-label') || ''));
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
 * Share a post via Messenger share dialog.
 * @param {Object} page - Puppeteer page (logged in)
 * @param {Object} target - Share target
 * @param {string} target.postUrl - URL of the post to share
 * @param {string} [target.message] - Optional message
 * @param {Object} [options]
 * @returns {Promise<{ok: boolean, postUrl: string, sharesClicked: number, error?: string, method?: string}>}
 */
export async function shareLinkByUid(page, target, options = {}) {
  const { postUrl, message } = target;
  const { delay = () => new Promise(r => setTimeout(r, 1000)) } = options;

  if (!postUrl) {
    return { ok: false, postUrl: '', error: 'Missing postUrl' };
  }

  try {
    // Navigate to post
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000, 5000);

    // Click share button
    const shareClicked = await page.evaluate(() => {
      const shareBtn = document.querySelector('div[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]');
      if (shareBtn) {
        const btn = shareBtn.closest('div[role="button"]') || shareBtn;
        btn.click();
        return true;
      }
      // XPath fallback
      const xpathResult = document.evaluate(
        '//div[@data-ad-rendering-role="share_button"]/ancestor::div[@role="button"]',
        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      );
      if (xpathResult.singleNodeValue) {
        xpathResult.singleNodeValue.click();
        return true;
      }
      return false;
    });

    if (!shareClicked) {
      return { ok: false, postUrl, error: 'Share button not found' };
    }

    await delay(2000, 3000);

    // Click all "via Messenger" buttons
    const { clicked, labels } = await clickAllMessengerButtons(page, delay);

    if (clicked === 0) {
      return { ok: false, postUrl, error: 'No Messenger buttons found in share dialog' };
    }

    return {
      ok: true,
      postUrl,
      sharesClicked: clicked,
      labels,
      method: 'share-dialog',
    };
  } catch (err) {
    return { ok: false, postUrl, error: err.message };
  }
}

/**
 * Batch share links to multiple posts.
 * @param {Object} page - Puppeteer page
 * @param {Object} campaign
 * @param {string[]} campaign.postUrls - Array of post URLs to share
 * @param {string} [campaign.message] - Optional message
 * @param {Object} [options]
 * @returns {Promise<Object>} runGuardedBatch result
 */
export async function shareLinkByUidCampaign(page, campaign, options = {}) {
  const { postUrls, message } = campaign;

  if (!Array.isArray(postUrls) || postUrls.length === 0) {
    throw new Error('❌ shareLinkByUidCampaign: postUrls must be a non-empty array');
  }

  const items = postUrls.map(url => ({
    postUrl: url,
    message,
    toString: () => url,
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

export default { shareLinkByUid, shareLinkByUidCampaign, clickAllMessengerButtons };
