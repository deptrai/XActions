// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Share link via UID - Direct Messenger URL approach (VERIFIED 2026-08).
 *
 * Flow:
 * 1. Navigate to facebook.com/messages/t/{uid}
 * 2. Paste post URL via clipboard API
 * 3. Press Enter to send
 *
 * This approach is more reliable than the share dialog because:
 * - Works with UIDs directly (no need for display names)
 * - Doesn't require recipients to be in the share dialog's friend list
 * - One-click send vs multi-step share dialog flow
 */

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';

/**
 * Send a post URL to a specific user via direct Messenger URL.
 * Uses clipboard API to paste URL into contenteditable compose box.
 *
 * @param {Object} page - Puppeteer page (logged in)
 * @param {string} recipientUid - Facebook UID of the recipient
 * @param {string} postUrl - URL of the post to share
 * @param {Function} delay - Delay function
 * @param {boolean} headless - Whether browser is running headless (affects delays for visibility)
 * @returns {Promise<{ok: boolean, recipientUid: string, error?: string, method?: string}>}
 */
async function sendUrlToUid(page, recipientUid, postUrl, delay, headless = true) {
  // Navigate to Messenger conversation with the recipient
  await page.goto(`https://www.facebook.com/messages/t/${recipientUid}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // When browser is visible, wait longer so user can see what's happening
  if (!headless) {
    await delay(8000, 12000);
  } else {
    await delay(5000, 8000);
  }

  // Check if the conversation opened correctly
  const conversationCheck = await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    const ariaLabel = editor?.getAttribute('aria-label') || '';
    return { hasEditor: !!editor, ariaLabel };
  });

  if (!conversationCheck.hasEditor) {
    return {
      ok: false,
      recipientUid,
      error: 'Message compose box not found - conversation may not be accessible',
    };
  }

  // When browser is visible, show conversation info
  if (!headless) {
    console.log(`[${recipientUid}] Conversation opened: ${conversationCheck.ariaLabel || 'Unknown'}`);
  }

  // Paste URL using clipboard API (contenteditable doesn't accept keyboard.type reliably)
  await page.evaluate(async (url) => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return;

    editor.focus();

    // Write to clipboard
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      // Fallback for headless clipboard restrictions
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    // Simulate paste event
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', url);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    editor.dispatchEvent(pasteEvent);
  }, postUrl);

  // When browser is visible, wait so user can see the pasted URL
  if (!headless) {
    await delay(3000, 5000);
  } else {
    await delay(1500, 2500);
  }

  // Press Enter to send
  if (!headless) {
    console.log(`[${recipientUid}] Sending message...`);
  }
  await page.keyboard.press('Enter');

  // When browser is visible, wait longer so user can see the sent message
  if (!headless) {
    await delay(3000, 5000);
  } else {
    await delay(2000, 3000);
  }

  return { ok: true, recipientUid, method: 'direct-messenger-url' };
}

/**
 * Share a post URL to a recipient via direct Messenger.
 * @param {Object} page - Puppeteer page (logged in)
 * @param {Object} target - Share target
 * @param {string} target.postUrl - URL of the post to share
 * @param {string} target.recipientUid - Facebook UID of the recipient
 * @param {string} [target.message] - Optional message (appended after URL)
 * @param {Object} [options]
 * @returns {Promise<{ok: boolean, postUrl: string, recipientUid?: string, sharesSent: number, error?: string, method?: string}>}
 */
export async function shareLinkByUid(page, target, options = {}) {
  const { postUrl, recipientUid, message } = target;
  const { delay = () => new Promise(r => setTimeout(r, 1000)), headless = true } = options;

  if (!postUrl) {
    return { ok: false, postUrl: '', error: 'Missing postUrl' };
  }

  try {
    const urlToShare = message ? `${postUrl}\n\n${message}` : postUrl;

    if (recipientUid) {
      // Direct UID share - navigate to messages/t/{uid}
      const result = await sendUrlToUid(page, recipientUid, urlToShare, delay, headless);
      return {
        ok: result.ok,
        postUrl,
        recipientUid,
        sharesSent: result.ok ? 1 : 0,
        error: result.error,
        method: result.method,
      };
    }

    // Fallback: share dialog approach (for backward compatibility)
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000, 5000);

    const shareClicked = await page.evaluate(() => {
      const shareBtn = document.querySelector(
        'div[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]'
      );
      if (shareBtn) {
        const btn = shareBtn.closest('[role="button"]') || shareBtn;
        btn.click();
        return true;
      }
      return false;
    });

    if (!shareClicked) {
      return { ok: false, postUrl, error: 'Share button not found' };
    }

    await delay(2000, 3000);

    // Look for "Share to a friend's profile" option
    const friendProfileClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"]')];
      const btn = btns.find((b) =>
        /Share to a friend's profile|Chia sẻ lên trang cá nhân/i.test(
          b.getAttribute('aria-label') || ''
        )
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!friendProfileClicked) {
      return { ok: false, postUrl, error: 'Friend profile share option not found' };
    }

    await delay(2000, 3000);

    return { ok: true, postUrl, sharesSent: 1, method: 'share-dialog-friend-profile' };
  } catch (err) {
    return { ok: false, postUrl, error: err.message };
  }
}

/**
 * Batch share links to multiple recipients.
 * @param {Object} page - Puppeteer page
 * @param {Object} campaign
 * @param {string} campaign.postUrl - URL of the post to share
 * @param {string[]} campaign.recipients - Array of Facebook UIDs
 * @param {string} [campaign.message] - Optional message
 * @param {Object} [options]
 * @returns {Promise<Object>} runGuardedBatch result
 */
export async function shareLinkByUidCampaign(page, campaign, options = {}) {
  const { postUrl, recipients, message } = campaign;

  if (!postUrl) {
    throw new Error('❌ shareLinkByUidCampaign: postUrl is required');
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('❌ shareLinkByUidCampaign: recipients must be a non-empty array');
  }

  const items = recipients.map((uid) => ({
    postUrl,
    recipientUid: uid,
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
