// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Messenger Share Automation (Story 5.2)
 *
 * Ports SST_TOOL_FB Main.cs:Post() lines 582–799 — share a post to Facebook
 * Pages via Messenger, compose & send message with random segment splitting.
 *
 * Design:
 * - Each share is an `actionFn` fed to `runGuardedBatch` (ADR-012).
 * - Dry-run by default (ADR-007) — no DOM interaction unless explicitly enabled.
 * - Delay seam injectable for browser-free unit tests.
 * - Selectors are UNVERIFIED — see docs/agents/selectors-facebook.md.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// ============================================================================
// Imports
// ============================================================================

import { runGuardedBatch } from '../../../api/services/facebookAutomation.js';

// ============================================================================
// Constants & Selectors (UNVERIFIED — need live Facebook session to confirm)
// ============================================================================

/**
 * Selectors for Messenger share dialog elements.
 * These mirror the C# source's element targeting but are UNVERIFIED against
 * current Facebook DOM. Facebook changes these frequently.
 */
export const SELECTORS = {
  // Share button on a post
  shareButton: '[aria-label="Send this to friends or post it on your timeline."], [aria-label="Share"], [data-testid="share_button"]',
  // "Send in Messenger" option in share menu
  sendInMessenger: '[role="menuitem"]:has-text("Send in Messenger"), [role="menuitem"]:has-text("Gửi trong Messenger")',
  // Messenger dialog search input for recipient
  recipientSearch: 'input[aria-label="Search"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"]',
  // Recipient suggestion row in Messenger dialog
  recipientRow: '[role="option"], [role="listbox"] [role="row"]',
  // Message compose input in Messenger share dialog
  messageInput: '[aria-label="Message"], [aria-label="Tin nhắn"], [role="textbox"][contenteditable="true"]',
  // Send button in Messenger dialog
  sendButton: '[aria-label="Send"], [aria-label="Gửi"], [data-testid="messenger_send_button"]',
  // Error state — "Couldn't send" indicator
  sendError: '[aria-label="Couldn\'t send"], [aria-label="Không thể gửi"]',
  // Dialog close / dismiss
  dialogClose: '[aria-label="Close"], [aria-label="Đóng"]',
};

// ============================================================================
// Pure Utilities (browser-free, testable)
// ============================================================================

/**
 * Strip emoji surrogates from text.
 * C# source: removes chars outside BMP (surrogate pairs) to avoid Messenger
 * rendering issues on some devices.
 *
 * @param {string} text - Input text
 * @returns {string} Text with emoji/surrogate pairs removed
 */
export function stripEmojiSurrogates(text) {
  if (!text) return '';
  // Remove astral plane characters (emoji, symbols above U+FFFF)
  // eslint-disable-next-line no-misleading-character-class
  return text.replace(/[\u{10000}-\u{10FFFF}]/gu, '').trim();
}

/**
 * Pick a random segment from text split by `**` delimiter.
 * C# source: splits content by "**", picks random segment for each send.
 * This creates message variation across recipients to reduce spam detection.
 *
 * @param {string} text - Full message text with `**` delimiters
 * @returns {string} One random segment (trimmed)
 */
export function pickRandomSegment(text) {
  if (!text) return '';
  const segments = text.split('**').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.length === 1) return segments[0];
  const idx = Math.floor(Math.random() * segments.length);
  return segments[idx];
}

/**
 * Build the final message: pick random segment, strip emoji, normalize newlines.
 *
 * @param {string} rawContent - Raw message content (may contain ** delimiters)
 * @param {Object} options
 * @param {boolean} [options.stripEmoji=true] - Whether to strip emoji surrogates
 * @param {Function} [options.segmentPicker=pickRandomSegment] - Segment picker fn
 * @returns {string} Final composed message
 */
export function composeMessage(rawContent, options = {}) {
  const { stripEmoji = true, segmentPicker = pickRandomSegment } = options;
  let message = segmentPicker(rawContent);
  if (stripEmoji) {
    message = stripEmojiSurrogates(message);
  }
  // Normalize whitespace but preserve intentional newlines
  return message.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================================
// DOM Interaction Helpers (require Puppeteer page)
// ============================================================================

/**
 * Type a multi-line message into the Messenger compose box.
 * Uses Shift+Enter for newlines (like the C# source) to avoid premature send.
 *
 * @param {Page} page - Puppeteer page instance
 * @param {string} message - Message to type
 * @param {Object} options
 * @param {Function} [options.delay] - Delay function between lines
 */
export async function typeMessage(page, message, options = {}) {
  const { delay = () => new Promise((r) => setTimeout(r, 50 + Math.random() * 100)) } = options;
  const lines = message.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      // Shift+Enter for newline without sending
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
      await delay();
    }
    if (lines[i]) {
      await page.keyboard.type(lines[i], { delay: 20 + Math.random() * 30 });
      await delay();
    }
  }
}

/**
 * Wait for a selector with fallback chain (tries multiple selectors).
 * Returns the first matching element or null if none found within timeout.
 *
 * @param {Page} page - Puppeteer page
 * @param {string} selectorChain - Comma-separated selector string
 * @param {number} [timeout=5000] - Max wait in ms
 * @returns {Promise<ElementHandle|null>}
 */
async function waitForAny(page, selectorChain, timeout = 5000) {
  const selectors = selectorChain.split(',').map((s) => s.trim());
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return el;
      } catch { /* selector parse error — skip */ }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// ============================================================================
// Core Share Function (single target — actionFn for runGuardedBatch)
// ============================================================================

/**
 * Share a post to a single recipient via Messenger.
 * This is the `actionFn` passed to `runGuardedBatch`.
 *
 * Flow (mirrors C# Main.cs:Post() lines 582–799):
 * 1. Navigate to the post URL
 * 2. Click Share button → "Send in Messenger"
 * 3. Search for recipient (page name) in Messenger dialog
 * 4. Select recipient
 * 5. Compose & type message
 * 6. Click Send
 * 7. Detect success or "Couldn't send" error
 *
 * @param {Page} page - Puppeteer page instance (logged in)
 * @param {Object} target - Share target
 * @param {string} target.recipientName - Name of the Page/person to share to
 * @param {string} target.postUrl - URL of the post to share
 * @param {string} target.message - Composed message to send with the share
 * @param {Object} [options]
 * @param {Function} [options.delay] - Injectable delay seam
 * @param {number} [options.selectorTimeout=8000] - Timeout for selector waits
 * @returns {Promise<{ok: boolean, recipientName: string, error?: string}>}
 */
export async function shareToMessenger(page, target, options = {}) {
  const {
    delay = (min = 1000, max = 3000) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min))),
    selectorTimeout = 8000,
  } = options;
  const { recipientName, postUrl, message } = target;

  if (!recipientName || !postUrl) {
    return { ok: false, recipientName: recipientName || '(unknown)', error: 'Missing recipientName or postUrl' };
  }

  try {
    // 1. Navigate to the post
    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000, 4000);

    // 2. Click Share button
    const shareBtn = await waitForAny(page, SELECTORS.shareButton, selectorTimeout);
    if (!shareBtn) {
      return { ok: false, recipientName, error: 'Share button not found (selector unverified)' };
    }
    await shareBtn.click();
    await delay(1000, 2000);

    // 3. Click "Send in Messenger" option
    const messengerOpt = await waitForAny(page, SELECTORS.sendInMessenger, selectorTimeout);
    if (!messengerOpt) {
      // Fallback: some post types open Messenger dialog directly from share click
      // Check if recipient search is already visible
      const directSearch = await waitForAny(page, SELECTORS.recipientSearch, 3000);
      if (!directSearch) {
        return { ok: false, recipientName, error: '"Send in Messenger" option not found' };
      }
    } else {
      await messengerOpt.click();
      await delay(1000, 2000);
    }

    // 4. Search for recipient
    const searchInput = await waitForAny(page, SELECTORS.recipientSearch, selectorTimeout);
    if (!searchInput) {
      return { ok: false, recipientName, error: 'Recipient search input not found' };
    }
    await searchInput.click();
    await delay(500, 1000);
    await page.keyboard.type(recipientName, { delay: 30 + Math.random() * 50 });
    await delay(1500, 3000);

    // 5. Select first matching recipient row
    const recipientRow = await waitForAny(page, SELECTORS.recipientRow, selectorTimeout);
    if (!recipientRow) {
      return { ok: false, recipientName, error: `Recipient "${recipientName}" not found in search results` };
    }
    await recipientRow.click();
    await delay(1000, 2000);

    // 6. Compose message (if provided)
    if (message) {
      const msgInput = await waitForAny(page, SELECTORS.messageInput, selectorTimeout);
      if (msgInput) {
        await msgInput.click();
        await delay(300, 600);
        await typeMessage(page, message, { delay: () => delay(50, 150) });
        await delay(500, 1000);
      }
      // If no message input found, proceed without message — share still works
    }

    // 7. Click Send
    const sendBtn = await waitForAny(page, SELECTORS.sendButton, selectorTimeout);
    if (!sendBtn) {
      return { ok: false, recipientName, error: 'Send button not found' };
    }
    await sendBtn.click();
    await delay(2000, 4000);

    // 8. Check for send error
    const sendErr = await waitForAny(page, SELECTORS.sendError, 3000);
    if (sendErr) {
      return { ok: false, recipientName, error: "Couldn't send — Messenger blocked or recipient unavailable" };
    }

    // 9. Dismiss dialog if still open
    const closeBtn = await waitForAny(page, SELECTORS.dialogClose, 2000);
    if (closeBtn) {
      await closeBtn.click();
      await delay(500, 1000);
    }

    return { ok: true, recipientName };
  } catch (err) {
    return { ok: false, recipientName, error: err.message };
  }
}

// ============================================================================
// Campaign Entry Point (batch — routes through runGuardedBatch)
// ============================================================================

/**
 * Run a Messenger share campaign: share a post to multiple recipients.
 * Routes all writes through `runGuardedBatch` (dry-run default, delay seam,
 * bounded batch per ADR-012).
 *
 * @param {Page} page - Puppeteer page instance (logged in via loginWithCookie)
 * @param {Object} campaign
 * @param {string} campaign.postUrl - URL of the post to share
 * @param {string[]} campaign.recipients - Array of Page/person names to share to
 * @param {string} [campaign.content] - Raw message content (may contain ** delimiters)
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - Dry-run mode (default: true via runGuardedBatch)
 * @param {boolean} [options.stripEmoji=true] - Strip emoji surrogates from message
 * @param {Function} [options.delay] - Injectable delay seam
 * @param {number} [options.selectorTimeout=8000] - DOM selector timeout
 * @param {Function} [options.composeFn=composeMessage] - Message compose function
 * @param {Function} [options.shareFn=shareToMessenger] - Share function (injectable for tests)
 * @param {number} [options.delayBetween] - Passed to runGuardedBatch
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>} runGuardedBatch result shape
 */
export async function messengerShareCampaign(page, campaign, options = {}) {
  const {
    stripEmoji = true,
    delay: delayFn,
    selectorTimeout = 8000,
    composeFn = composeMessage,
    shareFn = shareToMessenger,
    ...guardedOptions
  } = options;

  const { postUrl, recipients, content } = campaign;

  if (!postUrl) {
    throw new Error('❌ messengerShareCampaign: postUrl is required');
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('❌ messengerShareCampaign: recipients must be a non-empty array');
  }

  // Build batch items — each item is a target object for shareToMessenger
  const items = recipients.map((recipientName) => {
    // Compose a fresh message per recipient (random segment picking creates variation)
    const message = content ? composeFn(content, { stripEmoji }) : '';
    return {
      recipientName,
      postUrl,
      message,
      // runGuardedBatch uses .toString() or the item itself as target label
      toString: () => recipientName,
    };
  });

  // actionFn wraps shareToMessenger with page and options
  const actionFn = async (target) => {
    const result = await shareFn(page, target, { delay: delayFn, selectorTimeout });
    return result;
  };

  // Route through runGuardedBatch — dry-run default, delay seam, bounded batch
  const batchResult = await runGuardedBatch(items, actionFn, guardedOptions);

  return batchResult;
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  // Pure utilities
  stripEmojiSurrogates,
  pickRandomSegment,
  composeMessage,
  typeMessage,
  // DOM interaction
  shareToMessenger,
  // Campaign entry point
  messengerShareCampaign,
  // Constants
  SELECTORS,
};
