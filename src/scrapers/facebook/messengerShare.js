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

/** @typedef {import('puppeteer').Page} Page */
/** @typedef {import('puppeteer').ElementHandle} ElementHandle */

// ============================================================================
// Constants & Selectors (VERIFIED against live Facebook share dialog)
// ============================================================================

/**
 * Selectors VERIFIED against the live Facebook share dialog (2026-06).
 *
 * Real-DOM flow (differs from the original C# port):
 *   1. Click the post's Share button → an in-page share dialog opens.
 *   2. The dialog renders a row of recipient avatars under "Gửi bằng Messenger".
 *      Each recipient is a `div[role="button"]` whose aria-label is:
 *        VI: "Gửi cho <Name> qua Messenger"
 *        EN: "Send <Name> via Messenger"
 *   3. Clicking that avatar SENDS the post immediately (one-click). There is
 *      NO separate recipient search box and NO Messenger compose box in this
 *      dialog — the only editable field is an optional caption at the top.
 *
 * The previous selectors (recipientSearch / messageInput@font-size:15px /
 * css-img send button) did NOT exist in this dialog and produced false matches
 * (e.g. the header nav "Messenger" button, the post comment box), which made
 * the action report success without sending anything.
 *
 * Caption note: the share dialog DOES expose an editable caption box, and text
 * can be typed into it — but the recipient avatar is a one-click QUICK-SEND
 * button that fires immediately and DISCARDS the typed caption. Verified live:
 * the caption never reaches the conversation. Therefore the message is delivered
 * as a SEPARATE Messenger DM to the recipient's thread after the share (see
 * `sendMessageToThread`), rather than as a share caption.
 */
export const SELECTORS = {
  // Share button on a post — opens the share dialog.
  shareButton: 'div[data-ad-rendering-role="share_button"], [data-ad-renderingrole="share_button"]',
  // XPath fallback for share button (absolute — brittle).
  shareButtonXPath: '//div[@data-ad-rendering-role="share_button"]/..',

  // Recipient avatar buttons inside the share dialog. We scan all role=button
  // elements and match the aria-label against `recipientButtonLabelRe` + name.
  recipientButton: 'div[role="button"][aria-label], [role="button"][aria-label]',
  // aria-label patterns that mark a "send to X via Messenger" recipient button.
  recipientButtonLabelRe: /qua Messenger|via Messenger/i,

  // ---- Separate-DM delivery (message text) ----
  // Messenger inbox URL. We open the inbox, click the recipient's thread row by
  // name, then type into the thread compose box.
  messagesUrl: 'https://www.facebook.com/messages/t/',
  // Sidebar thread link rows (match by visible name).
  threadLink: 'a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]',
  // Thread compose box. aria-label is "Viết cho <Name>" (VI) / "Message <Name>"
  // (EN); placeholder "Aa". Matching by role+contenteditable+placeholder is the
  // most stable across locales.
  threadComposeBox: 'div[role="textbox"][contenteditable="true"][aria-placeholder="Aa"], div[role="textbox"][contenteditable="true"]',
  // Send button that appears once the compose box has content. The e2ee (Lexical)
  // box does NOT send on Enter via Puppeteer; this button must be clicked.
  // aria-label "Nhấn Enter để gửi" (VI) / "Press Enter to send" (EN).
  sendButtonLabelNeedles: ['nhấn enter để gửi', 'press enter to send'],

  // Error — a "couldn't send" style toast/span after sending.
  sendErrorText: ["Couldn't send", 'Không thể gửi', 'Đã xảy ra lỗi'],
  sendError: 'span',

  // Dialog close.
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
 * @param {FacebookOptions} options
 * @returns {string} Final composed message
 */
export function composeMessage(rawContent, options = {}) {
  const { stripEmoji = true, segmentPicker = pickRandomSegment } = options;
  const picked = segmentPicker(rawContent);
  // Guard against non-string segment-picker output (null/undefined/number/etc.)
  // so the downstream `.replace()` calls cannot throw on a non-string value.
  const message = typeof picked === 'string'
    ? picked
    : (picked == null ? '' : String(picked));
  const clean = stripEmoji ? stripEmojiSurrogates(message) : message;
  // Normalize whitespace but preserve intentional newlines
  return clean.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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
 * @param {FacebookOptions} options
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

/**
 * Wait for the first element matching `selector` whose visible text contains
 * one of the given `texts` (case-insensitive, trimmed). This replaces
 * Playwright's `:has-text()` pseudo-class, which is invalid CSS under
 * Puppeteer's `page.$$()`.
 *
 * @param {Page} page - Puppeteer page
 * @param {string} selector - Plain CSS selector (e.g. '[role="menuitem"]')
 * @param {string[]} texts - Visible-text needles to match (any one matches)
 * @param {number} [timeout=5000] - Max wait in ms
 * @returns {Promise<ElementHandle|null>}
 */
async function findByText(page, selector, texts, timeout = 5000) {
  const needles = texts.map((t) => t.trim().toLowerCase());
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const handles = await page.$$(selector);
      for (const handle of handles) {
        const txt = await page.evaluate((el) => (el.textContent || '').trim().toLowerCase(), handle);
        if (needles.some((n) => txt.includes(n))) return handle;
        await handle.dispose();
      }
    } catch { /* selector parse error — skip */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// ============================================================================
// Core Share Function (single target — actionFn for runGuardedBatch)
// ============================================================================

/**
 * Find and click the recipient avatar in the share dialog whose aria-label
 * marks it as a "send to <name> via Messenger" button AND contains `name`.
 *
 * Clicking this button SENDS the post immediately (one-click). Matching is done
 * inside a single page.evaluate so we operate on the live DOM snapshot and click
 * the exact node — avoiding stale ElementHandles.
 *
 * @param {Page} page - Puppeteer page
 * @param {string} name - Recipient display name (e.g. "Sang Sang")
 * @param {RegExp} labelRe - Pattern that marks a Messenger-recipient button
 * @returns {Promise<string|null>} The clicked aria-label, or null if not found
 */
async function clickRecipientByName(page, name, labelRe) {
  return page.evaluate((needle, reSource, reFlags) => {
    const re = new RegExp(reSource, reFlags);
    const needleLc = (needle || '').trim().toLowerCase();
    const buttons = [...document.querySelectorAll('[role="button"][aria-label]')];
    const target = buttons.find((b) => {
      const label = b.getAttribute('aria-label') || '';
      return re.test(label) && label.toLowerCase().includes(needleLc);
    });
    if (!target) return null;
    target.click();
    return target.getAttribute('aria-label');
  }, name, labelRe.source, labelRe.flags);
}

/**
 * Poll until at least one Messenger-recipient button is present in the dialog.
 * Matches on aria-label (NOT visible text — the visible text is just the name,
 * the "via Messenger" marker lives only in the aria-label).
 *
 * @param {Page} page - Puppeteer page
 * @param {RegExp} labelRe - Pattern that marks a Messenger-recipient button
 * @param {number} timeout - Max wait in ms
 * @returns {Promise<number>} Count of matching recipient buttons (0 if none)
 */
async function waitForRecipientButtons(page, labelRe, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const count = await page.evaluate((reSource, reFlags) => {
      const re = new RegExp(reSource, reFlags);
      return [...document.querySelectorAll('[role="button"][aria-label]')]
        .filter((b) => re.test(b.getAttribute('aria-label') || '')).length;
    }, labelRe.source, labelRe.flags);
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 200));
  }
  return 0;
}

/**
 * Send a plain-text message as a SEPARATE Messenger DM to a recipient's thread.
 *
 * Used because the share dialog's recipient avatar is a one-click quick-send
 * button that discards any typed caption (verified live). To attach a message
 * to a share, we share the post first, then open the recipient's Messenger
 * thread and send the text as its own message.
 *
 * Flow:
 * 1. Open the Messenger inbox.
 * 2. Click the sidebar thread row matching `recipientName`.
 * 3. Type `message` into the thread compose box and press Enter to send.
 *
 * @param {import('puppeteer').Page} page - Puppeteer page instance (logged in)
 * @param {string} recipientName - Display name of the thread to open
 * @param {string} message - Plain-text message to send
 * @param {FacebookOptions} [options]
 * @returns {Promise<{ok: boolean, sentVia?: string, error?: string}>}
 */
export async function sendMessageToThread(page, recipientName, message, options = {}) {
  const {
    delay = (min = 1000, max = 3000) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min))),
    selectorTimeout = 10000,
  } = options;

  if (!message) return { ok: true }; // nothing to send

  try {
    // 1. Open the inbox (full Messenger surface, not the lightweight overlay).
    if (!page.url().includes('/messages/')) {
      await page.goto(SELECTORS.messagesUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(2000, 4000);
    }

    // 2. Click the sidebar thread row whose visible text contains the name.
    const opened = await page.evaluate((needle) => {
      const needleLc = (needle || '').trim().toLowerCase();
      const links = [...document.querySelectorAll('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]')];
      const target = links.find((a) => (a.innerText || '').toLowerCase().includes(needleLc));
      if (!target) return false;
      target.click();
      return true;
    }, recipientName);
    if (!opened) {
      return { ok: false, error: `Thread for "${recipientName}" not found in inbox` };
    }
    await delay(2000, 4000);

    // 3. Type into the thread compose box, then send with Enter.
    // IMPORTANT: the e2ee compose box does NOT reliably receive input via
    // page.keyboard after a click() — verified live, the keystrokes land
    // "nowhere". ElementHandle.type() focuses + types directly into the node and
    // works. Type line-by-line, inserting Shift+Enter between lines (the handle
    // keeps focus, so page.keyboard works between handle.type() calls).
    const composeBox = await waitForAny(page, SELECTORS.threadComposeBox, selectorTimeout);
    if (!composeBox) {
      return { ok: false, error: 'Thread compose box not found' };
    }
    const lines = message.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await delay(50, 150);
      }
      if (lines[i]) {
        await composeBox.type(lines[i], { delay: 20 + Math.random() * 30 });
        await delay(50, 150);
      }
    }
    await delay(400, 800);

    // 4. Send. The e2ee (Lexical) compose box does NOT send on
    // page.keyboard.press('Enter') or composeBox.press('Enter') — verified live,
    // the text stays in the box. A dedicated send button appears once the box has
    // content, with aria-label "Nhấn Enter để gửi" (VI) / "Press Enter to send"
    // (EN). Click it. Fall back to Enter for non-e2ee threads where it works.
    const sent = await page.evaluate((labelNeedles) => {
      const btns = [...document.querySelectorAll('[role="button"][aria-label]')];
      const target = btns.find((b) => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return labelNeedles.some((n) => label.includes(n));
      });
      if (!target) return null;
      target.click();
      return target.getAttribute('aria-label');
    }, SELECTORS.sendButtonLabelNeedles);

    if (!sent) {
      // Fallback: classic Enter-to-send (works on non-e2ee threads).
      await page.keyboard.press('Enter');
    }
    await delay(1500, 3000);

    return { ok: true, sentVia: sent || 'enter-fallback' };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Share a post to a single recipient via Messenger.
 * This is the `actionFn` passed to `runGuardedBatch`.
 *
 * Flow (VERIFIED against the live share dialog — see SELECTORS doc above):
 * 1. Navigate to the post URL.
 * 2. Click the post's Share button → in-page share dialog opens.
 * 3. Click the recipient avatar matching `recipientName` → post is sent (one-click).
 * 4. Check for a "couldn't send" error toast.
 * 5. If `message` is provided, deliver it as a SEPARATE Messenger DM to the
 *    recipient's thread (the share dialog discards typed captions on quick-send).
 *
 * The legacy GraphQL `MWChatBusinessCTAAdsSenderMutation` step was removed: it
 * consistently returned `messenger_business_ads_sender: null` and was not
 * required for recipients with an existing conversation. `pageId` is now
 * ignored (kept in the signature for backward compatibility).
 *
 * @param {import('puppeteer').Page} page - Puppeteer page instance (logged in)
 * @param {{ recipientName: string; postUrl: string; message?: string; [key: string]: unknown }} target - Share target
 * @param {FacebookOptions} [options]
 * @returns {Promise<{ok: boolean, recipientName: string, clickedLabel?: string, messageDelivered?: boolean, messageError?: string, error?: string }>}
 */
export async function shareToMessenger(page, target, options = {}) {
  const {
    delay = (min = 1000, max = 3000) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min))),
    selectorTimeout = 8000,
    sendMessageFn = sendMessageToThread,
  } = options;
  const { recipientName, postUrl, message } = target;

  if (!recipientName || !postUrl) {
    return { ok: false, recipientName: recipientName || '(unknown)', error: 'Missing recipientName or postUrl' };
  }

  try {
    // 1. Navigate to the post
    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000, 4000);

    // 2. Click Share button → opens the in-page share dialog.
    // Use a JS click: the button is sometimes covered by overlays that swallow
    // a synthetic mouse click but not element.click().
    let shareBtn = await waitForAny(page, SELECTORS.shareButton, selectorTimeout);
    if (!shareBtn) {
      shareBtn = /** @type {import('puppeteer').ElementHandle|null} */ (await page.evaluate((xpath) => {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = result.singleNodeValue;
        // Only an ELEMENT can be clicked — a text/comment node match would blow up
        // later at el.click() with an opaque TypeError.
        return node && node.nodeType === 1 ? node : null;
      }, SELECTORS.shareButtonXPath));
      if (!shareBtn) return { ok: false, recipientName, error: 'Share button not found' };
    }
    await page.evaluate((el) => el.click(), shareBtn);
    await delay(1500, 3000);

    // 3. Wait for at least one Messenger recipient button to render in the dialog.
    // Match on aria-label (the "via Messenger" marker is in the aria-label, NOT
    // the visible text — the visible text is only the recipient's name).
    const recipientCount = await waitForRecipientButtons(
      page,
      SELECTORS.recipientButtonLabelRe,
      selectorTimeout
    );
    if (recipientCount === 0) {
      return { ok: false, recipientName, error: 'Share dialog / Messenger recipients did not render' };
    }

    // 4. Click the recipient avatar → SENDS the post immediately (one-click).
    const clickedLabel = await clickRecipientByName(
      page,
      recipientName,
      SELECTORS.recipientButtonLabelRe
    );
    if (!clickedLabel) {
      return { ok: false, recipientName, error: `Recipient "${recipientName}" not found in share dialog` };
    }
    await delay(2000, 4000);

    // 5. Check for a "couldn't send" error toast.
    const errSpans = await page.$$eval(SELECTORS.sendError, (spans, texts) => {
      return spans.filter((s) => texts.some((t) => s.textContent.includes(t))).length;
    }, SELECTORS.sendErrorText);
    if (errSpans > 0) {
      return { ok: false, recipientName, error: "Couldn't send — blocked or unavailable" };
    }

    // 6. Dismiss the dialog if still open.
    const closeBtn = await waitForAny(page, SELECTORS.dialogClose, 2000);
    if (closeBtn) {
      await page.evaluate((el) => el.click(), closeBtn);
      await delay(500, 1000);
    }

    // 7. Deliver the message as a SEPARATE DM (the share dialog discards captions
    // on quick-send). The share itself already succeeded above, so a DM failure is
    // reported but does not undo the share.
    let messageDelivered;
    if (message) {
      const dm = await sendMessageFn(page, recipientName, message, { delay, selectorTimeout });
      messageDelivered = dm.ok;
      if (!dm.ok) {
        return { ok: true, recipientName, clickedLabel, messageDelivered: false, messageError: dm.error };
      }
    }

    return { ok: true, recipientName, clickedLabel, ...(message ? { messageDelivered } : {}) };
  } catch (err) {
    return { ok: false, recipientName, error: (err instanceof Error ? err.message : String(err)) };
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
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>>} runGuardedBatch result shape
 */
export async function messengerShareCampaign(page, campaign, options = {}) {
  const {
    stripEmoji = true,
    delay: delayFn,
    selectorTimeout = 8000,
    composeFn = composeMessage,
    shareFn = shareToMessenger,
    batchFn = runGuardedBatch,
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
  /** @param {Record<string, unknown>} target */
  const actionFn = /** @type {(...args: unknown[]) => unknown} */ (async (target) => {
    const result = await shareFn(page, /** @type {{ recipientName: string; postUrl: string; message?: string }} */ (target), { delay: delayFn, selectorTimeout });
    return result;
  });

  // Route through runGuardedBatch — dry-run default, delay seam, bounded batch
  const batchResult = /** @type {Record<string, unknown>} */ (await batchFn(items, actionFn, guardedOptions));

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
  sendMessageToThread,
  // Campaign entry point
  messengerShareCampaign,
  // Constants
  SELECTORS,
};
