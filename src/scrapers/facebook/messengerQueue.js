// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook Messenger-share input/queue parser (Story 5.4 — Messenger Port, Epic 5).
 *
 * Pure, browser-free port of SST_TOOL_FB Main.cs:Post() file-queue (P10). The C#
 * tool drove campaigns from flat text files popped FIFO across a worker pool:
 *   - recipients list — target Pages a post is shared to via Messenger
 *   - content file     — message body (may contain `**`-delimited segments)
 *   - txtlinkss.txt    — the post URL(s) to share
 *
 * XActions is single-campaign-per-invocation, so the FIFO here means
 * **deterministic ordering + no double-send within a run**, not cross-process
 * locking. This module ONLY parses + pairs inputs; it routes to the already-
 * implemented `messengerShareCampaign` (Story 5.2) — no automation logic here.
 *
 * Design notes:
 *  - All functions pure + synchronous; null/empty/whitespace-safe (never throw).
 *  - De-dup preserves first-seen order (FIFO) per AC2/AC3.
 *  - Pairing rule (AC4): ONE campaign per link, each sharing the same full
 *    recipients array + content (mirrors C# — every link → every target page).
 *  - Links must match facebook.com; bad lines are dropped + tallied, not thrown.
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 * @see SST_TOOL_FB/Main.cs:Post() (file-queue / P10)
 * @see src/scrapers/facebook/messengerShare.js (messengerShareCampaign — campaign shape)
 */

// ============================================================================
// Constants
// ============================================================================

/** A line is a comment when it starts with `#` (after trimming). */
const COMMENT_PREFIX = '#';

/** Links must reference facebook.com to be a valid post URL (AC3). */
const FACEBOOK_URL_RE = /facebook\.com\//i;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Split raw text into cleaned, FIFO-ordered, de-duplicated lines.
 * Shared cleaning core for both recipients and links:
 *   - split on newlines (\r\n and \n)
 *   - trim each line
 *   - drop blank lines and `#` comments
 *   - de-duplicate while preserving first-seen order
 *
 * @param {string|null|undefined} text
 * @returns {string[]} cleaned unique lines in original order
 */
function cleanLines(text) {
  if (text == null || typeof text !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue; // blank
    if (line.startsWith(COMMENT_PREFIX)) continue; // comment
    if (seen.has(line)) continue; // dedup, FIFO-preserving
    seen.add(line);
    out.push(line);
  }
  return out;
}

// ============================================================================
// Public parsers — AC1
// ============================================================================

/**
 * Parse a recipients file (one Page id/name per line).
 * Trims, drops blanks + `#` comments, de-dups preserving first-seen order.
 *
 * @param {string|null|undefined} text
 * @returns {string[]} recipient identifiers (FIFO, unique)
 */
export function parseRecipientsFile(text) {
  return cleanLines(text);
}

/**
 * Parse a links file (one post URL per line). Same cleaning rules as recipients,
 * but additionally each entry MUST match facebook.com — non-matching lines are
 * dropped and counted in `skipped` (do not throw on a single bad line, AC3).
 *
 * @param {string|null|undefined} text
 * @returns {{ links: string[], skipped: number }}
 */
export function parseLinksFile(text) {
  const cleaned = cleanLines(text);
  const links = [];
  let skipped = 0;
  for (const line of cleaned) {
    if (FACEBOOK_URL_RE.test(line)) {
      links.push(line);
    } else {
      skipped += 1; // non-facebook URL — drop + tally, never throw
    }
  }
  return { links, skipped };
}

// ============================================================================
// Queue builder — AC4
// ============================================================================

/**
 * Build the campaign queue from parsed inputs. Accepts EITHER raw text
 * (recipientsText/linksText) which it parses, OR pre-parsed arrays
 * (recipients/links) for callers that already cleaned inline inputs.
 *
 * Pairing rule (AC4): ONE campaign per link, each campaign sharing the SAME
 * full recipients array + content (every link broadcast to every target page).
 * FIFO order preserved. Empty/whitespace/null inputs → empty queue, never throw.
 *
 * @param {object} input
 * @param {string} [input.recipientsText] - raw recipients file text
 * @param {string[]} [input.recipients]    - pre-parsed recipients (overrides text)
 * @param {string} [input.linksText]        - raw links file text
 * @param {string[]} [input.links]          - pre-parsed links (overrides text; still facebook.com-filtered)
 * @param {string} [input.content]          - message body (with optional `**` segments)
 * @returns {{ campaigns: Array<{ postUrl: string, recipients: string[], content: string }>,
 *             stats: { recipients: number, links: number, skipped: number } }}
 */
export function buildCampaignQueue(input = {}) {
  const { recipientsText, recipients, linksText, links, content } = input ?? {};

  // Recipients: prefer pre-parsed array, else parse text. Always clean/dedup.
  const recipientList = Array.isArray(recipients)
    ? cleanLines(recipients.join('\n'))
    : parseRecipientsFile(recipientsText);

  // Links: prefer pre-parsed array, else parse text. Always facebook.com-filter
  // + tally skipped so inline arrays get the same validation as files.
  let linkList;
  let skipped;
  if (Array.isArray(links)) {
    const parsed = parseLinksFile(links.join('\n'));
    linkList = parsed.links;
    skipped = parsed.skipped;
  } else {
    const parsed = parseLinksFile(linksText);
    linkList = parsed.links;
    skipped = parsed.skipped;
  }

  const safeContent = typeof content === 'string' ? content : '';

  // One campaign per link. If no links or no recipients, the queue is empty —
  // surface validation lives in the CLI/MCP/REST layers (fail-fast there).
  const campaigns =
    linkList.length && recipientList.length
      ? linkList.map((postUrl) => ({
          postUrl,
          recipients: [...recipientList], // fresh copy per campaign (no shared mutation)
          content: safeContent,
        }))
      : [];

  return {
    campaigns,
    stats: {
      recipients: recipientList.length,
      links: linkList.length,
      skipped,
    },
  };
}

// ============================================================================
// Default export (parity with sibling modules)
// ============================================================================

export default {
  parseRecipientsFile,
  parseLinksFile,
  buildCampaignQueue,
};
