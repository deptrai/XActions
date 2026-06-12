// tests/scrapers/facebook-messenger-queue.test.js
// Story 5.4 — AC1–AC5: pure, browser-free tests for the messenger-share
// input/queue parser (parseRecipientsFile, parseLinksFile, buildCampaignQueue).
// No network, no DOM, no fixtures — these functions are pure + synchronous.
// by nichxbt

import { describe, it, expect } from 'vitest';
import {
  parseRecipientsFile,
  parseLinksFile,
  buildCampaignQueue,
} from '../../src/scrapers/facebook/messengerQueue.js';

// ============================================================================
// parseRecipientsFile — AC2
// ============================================================================

describe('parseRecipientsFile', () => {
  it('splits on newlines and trims each line', () => {
    expect(parseRecipientsFile('  page1  \n page2\n\tpage3\t')).toEqual([
      'page1',
      'page2',
      'page3',
    ]);
  });

  it('handles \\r\\n (Windows) line endings', () => {
    expect(parseRecipientsFile('page1\r\npage2\r\npage3')).toEqual([
      'page1',
      'page2',
      'page3',
    ]);
  });

  it('drops blank and whitespace-only lines', () => {
    expect(parseRecipientsFile('page1\n\n   \n\t\npage2')).toEqual(['page1', 'page2']);
  });

  it('drops # comment lines', () => {
    expect(parseRecipientsFile('# header comment\npage1\n#another\npage2')).toEqual([
      'page1',
      'page2',
    ]);
  });

  it('de-duplicates while preserving first-seen (FIFO) order', () => {
    expect(parseRecipientsFile('page2\npage1\npage2\npage3\npage1')).toEqual([
      'page2',
      'page1',
      'page3',
    ]);
  });

  it('returns [] for empty string', () => {
    expect(parseRecipientsFile('')).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(parseRecipientsFile('   \n\t\n  ')).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(parseRecipientsFile(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseRecipientsFile(undefined)).toEqual([]);
  });

  it('returns [] for non-string input', () => {
    expect(parseRecipientsFile(42)).toEqual([]);
    expect(parseRecipientsFile({})).toEqual([]);
  });
});

// ============================================================================
// parseLinksFile — AC3
// ============================================================================

describe('parseLinksFile', () => {
  it('keeps facebook.com URLs and reports zero skipped', () => {
    const text = 'https://facebook.com/post/1\nhttps://www.facebook.com/post/2';
    expect(parseLinksFile(text)).toEqual({
      links: ['https://facebook.com/post/1', 'https://www.facebook.com/post/2'],
      skipped: 0,
    });
  });

  it('matches facebook.com case-insensitively', () => {
    const { links, skipped } = parseLinksFile('https://FaceBook.com/p/9');
    expect(links).toEqual(['https://FaceBook.com/p/9']);
    expect(skipped).toBe(0);
  });

  it('drops non-facebook URLs and tallies them in skipped (does not throw)', () => {
    const text = [
      'https://facebook.com/post/1',
      'https://twitter.com/x/1', // skip
      'https://instagram.com/p/2', // skip
      'https://www.facebook.com/post/3',
    ].join('\n');
    const { links, skipped } = parseLinksFile(text);
    expect(links).toEqual([
      'https://facebook.com/post/1',
      'https://www.facebook.com/post/3',
    ]);
    expect(skipped).toBe(2);
  });

  it('applies the same clean/dedup/comment rules before filtering', () => {
    const text = [
      '# links file',
      '  https://facebook.com/post/1  ',
      'https://facebook.com/post/1', // dup → removed before filter
      '',
      'not-a-url', // skip (non-fb)
    ].join('\n');
    const { links, skipped } = parseLinksFile(text);
    expect(links).toEqual(['https://facebook.com/post/1']);
    expect(skipped).toBe(1);
  });

  it('returns empty links + zero skipped for empty/null input', () => {
    expect(parseLinksFile('')).toEqual({ links: [], skipped: 0 });
    expect(parseLinksFile(null)).toEqual({ links: [], skipped: 0 });
    expect(parseLinksFile(undefined)).toEqual({ links: [], skipped: 0 });
  });
});

// ============================================================================
// buildCampaignQueue — AC4 / AC5
// ============================================================================

describe('buildCampaignQueue', () => {
  it('builds one campaign per link, each with the full recipients + content', () => {
    const { campaigns, stats } = buildCampaignQueue({
      recipientsText: 'pageA\npageB',
      linksText: 'https://facebook.com/post/1\nhttps://facebook.com/post/2',
      content: 'hello **world',
    });

    expect(campaigns).toHaveLength(2);
    expect(campaigns[0]).toEqual({
      postUrl: 'https://facebook.com/post/1',
      recipients: ['pageA', 'pageB'],
      content: 'hello **world',
    });
    expect(campaigns[1]).toEqual({
      postUrl: 'https://facebook.com/post/2',
      recipients: ['pageA', 'pageB'],
      content: 'hello **world',
    });
    expect(stats).toEqual({ recipients: 2, links: 2, skipped: 0 });
  });

  it('preserves FIFO order of links across campaigns', () => {
    const { campaigns } = buildCampaignQueue({
      recipientsText: 'pageA',
      linksText: 'https://facebook.com/z\nhttps://facebook.com/a\nhttps://facebook.com/m',
      content: 'x',
    });
    expect(campaigns.map((c) => c.postUrl)).toEqual([
      'https://facebook.com/z',
      'https://facebook.com/a',
      'https://facebook.com/m',
    ]);
  });

  it('gives each campaign an independent recipients copy (no shared mutation)', () => {
    const { campaigns } = buildCampaignQueue({
      recipientsText: 'pageA\npageB',
      linksText: 'https://facebook.com/1\nhttps://facebook.com/2',
      content: 'x',
    });
    campaigns[0].recipients.push('MUTATED');
    expect(campaigns[1].recipients).toEqual(['pageA', 'pageB']);
  });

  it('accepts pre-parsed recipients/links arrays (inline path)', () => {
    const { campaigns, stats } = buildCampaignQueue({
      recipients: ['pageA', 'pageA', 'pageB'], // dedup applies
      links: ['https://facebook.com/1', 'https://nope.com/2'], // fb-filter applies
      content: 'hi',
    });
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].recipients).toEqual(['pageA', 'pageB']);
    expect(campaigns[0].postUrl).toBe('https://facebook.com/1');
    expect(stats).toEqual({ recipients: 2, links: 1, skipped: 1 });
  });

  it('returns empty queue when there are no links', () => {
    const { campaigns, stats } = buildCampaignQueue({
      recipientsText: 'pageA',
      linksText: '',
      content: 'x',
    });
    expect(campaigns).toEqual([]);
    expect(stats).toEqual({ recipients: 1, links: 0, skipped: 0 });
  });

  it('returns empty queue when there are no recipients', () => {
    const { campaigns, stats } = buildCampaignQueue({
      recipientsText: '',
      linksText: 'https://facebook.com/1',
      content: 'x',
    });
    expect(campaigns).toEqual([]);
    expect(stats).toEqual({ recipients: 0, links: 1, skipped: 0 });
  });

  it('defaults content to empty string when missing', () => {
    const { campaigns } = buildCampaignQueue({
      recipientsText: 'pageA',
      linksText: 'https://facebook.com/1',
    });
    expect(campaigns[0].content).toBe('');
  });

  it('is null/empty-safe — no args → empty queue, never throws', () => {
    expect(buildCampaignQueue()).toEqual({
      campaigns: [],
      stats: { recipients: 0, links: 0, skipped: 0 },
    });
    expect(buildCampaignQueue({})).toEqual({
      campaigns: [],
      stats: { recipients: 0, links: 0, skipped: 0 },
    });
    expect(buildCampaignQueue(null)).toEqual({
      campaigns: [],
      stats: { recipients: 0, links: 0, skipped: 0 },
    });
  });
});
