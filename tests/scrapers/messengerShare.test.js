// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Story 5.2 — Messenger Share automation tests.
 * Browser-free: pure utilities tested directly; DOM interaction tested via mocks.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  stripEmojiSurrogates,
  pickRandomSegment,
  composeMessage,
  typeMessage,
  shareToMessenger,
  messengerShareCampaign,
  SELECTORS,
} from '../../src/scrapers/facebook/messengerShare.js';

// ============================================================================
// Pure Utilities
// ============================================================================

describe('stripEmojiSurrogates', () => {
  it('removes emoji from text', () => {
    expect(stripEmojiSurrogates('Hello 🌍 World 🚀')).toBe('Hello  World');
  });

  it('preserves BMP characters (accents, CJK)', () => {
    expect(stripEmojiSurrogates('café résumé 日本語')).toBe('café résumé 日本語');
  });

  it('returns empty string for null/undefined', () => {
    expect(stripEmojiSurrogates(null)).toBe('');
    expect(stripEmojiSurrogates(undefined)).toBe('');
    expect(stripEmojiSurrogates('')).toBe('');
  });

  it('trims whitespace after removal', () => {
    expect(stripEmojiSurrogates('  🎉 test 🎉  ')).toBe('test');
  });
});

describe('pickRandomSegment', () => {
  it('splits on ** delimiter and returns one segment', () => {
    const text = 'Hello**World**Goodbye';
    const result = pickRandomSegment(text);
    expect(['Hello', 'World', 'Goodbye']).toContain(result);
  });

  it('returns the only segment when no ** delimiter', () => {
    expect(pickRandomSegment('single segment')).toBe('single segment');
  });

  it('trims whitespace from segments', () => {
    const text = ' Hello ** World ';
    const result = pickRandomSegment(text);
    expect(['Hello', 'World']).toContain(result);
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(pickRandomSegment(null)).toBe('');
    expect(pickRandomSegment(undefined)).toBe('');
    expect(pickRandomSegment('')).toBe('');
  });

  it('skips empty segments from consecutive **', () => {
    const text = 'A****B';
    const result = pickRandomSegment(text);
    expect(['A', 'B']).toContain(result);
  });
});

describe('composeMessage', () => {
  it('picks a segment and strips emoji by default', () => {
    const result = composeMessage('Hello 🌍**World 🚀', {
      segmentPicker: (t) => t.split('**')[0].trim(),
    });
    expect(result).toBe('Hello');
  });

  it('preserves emoji when stripEmoji=false', () => {
    const result = composeMessage('Hello 🌍', {
      stripEmoji: false,
      segmentPicker: (t) => t,
    });
    expect(result).toBe('Hello 🌍');
  });

  it('normalizes excessive whitespace', () => {
    const result = composeMessage('Hello    World', {
      segmentPicker: (t) => t,
    });
    expect(result).toBe('Hello World');
  });

  it('collapses 3+ newlines to double', () => {
    const result = composeMessage('A\n\n\n\nB', {
      segmentPicker: (t) => t,
    });
    expect(result).toBe('A\n\nB');
  });
});

// ============================================================================
// DOM Interaction (mocked Puppeteer page)
// ============================================================================

function createMockPage() {
  const keyboard = {
    type: vi.fn(),
    press: vi.fn(),
    down: vi.fn(),
    up: vi.fn(),
  };
  const mockElement = {
    click: vi.fn(),
  };
  return {
    keyboard,
    goto: vi.fn(),
    $: vi.fn().mockResolvedValue(mockElement),
    mockElement,
  };
}

describe('typeMessage', () => {
  it('types single-line message without Shift+Enter', async () => {
    const page = createMockPage();
    await typeMessage(page, 'Hello World', { delay: () => Promise.resolve() });
    expect(page.keyboard.type).toHaveBeenCalledWith('Hello World', expect.any(Object));
    expect(page.keyboard.down).not.toHaveBeenCalled();
  });

  it('uses Shift+Enter for newlines', async () => {
    const page = createMockPage();
    await typeMessage(page, 'Line1\nLine2', { delay: () => Promise.resolve() });
    expect(page.keyboard.down).toHaveBeenCalledWith('Shift');
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    expect(page.keyboard.up).toHaveBeenCalledWith('Shift');
    expect(page.keyboard.type).toHaveBeenCalledTimes(2);
  });

  it('handles empty lines in multi-line message', async () => {
    const page = createMockPage();
    await typeMessage(page, 'A\n\nB', { delay: () => Promise.resolve() });
    // Two Shift+Enter presses for two newlines
    expect(page.keyboard.down).toHaveBeenCalledTimes(2);
    // Only types non-empty lines: 'A' and 'B'
    expect(page.keyboard.type).toHaveBeenCalledTimes(2);
  });
});

describe('shareToMessenger', () => {
  it('returns error when recipientName is missing', async () => {
    const page = createMockPage();
    const result = await shareToMessenger(page, { postUrl: 'https://fb.com/post/1', recipientName: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing recipientName/);
  });

  it('returns error when postUrl is missing', async () => {
    const page = createMockPage();
    const result = await shareToMessenger(page, { recipientName: 'TestPage', postUrl: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing recipientName or postUrl/);
  });

  it('returns error when share button not found', async () => {
    const page = createMockPage();
    page.$ = vi.fn().mockResolvedValue(null); // no elements found
    const result = await shareToMessenger(
      page,
      { recipientName: 'TestPage', postUrl: 'https://fb.com/post/1', message: 'Hi' },
      { delay: () => Promise.resolve(), selectorTimeout: 100 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Share button not found/);
  });

  it('succeeds when all selectors resolve', async () => {
    const page = createMockPage();
    // Return null for error/close selectors so waitForAny times out on them
    const mockElement = { click: vi.fn() };
    const errorSelectors = ["Couldn't send", 'Không thể gửi', 'Close', 'Đóng'];
    page.$.mockImplementation(async (sel) => {
      if (errorSelectors.some((s) => sel.includes(s))) return null;
      return mockElement;
    });
    const result = await shareToMessenger(
      page,
      { recipientName: 'TestPage', postUrl: 'https://fb.com/post/1', message: 'Hello' },
      { delay: () => Promise.resolve(), selectorTimeout: 100 },
    );
    expect(result.ok).toBe(true);
    expect(result.recipientName).toBe('TestPage');
  });
});

// ============================================================================
// Campaign (integration with runGuardedBatch mock)
// ============================================================================

// Mock runGuardedBatch to avoid importing the full module
vi.mock('../../api/services/facebookAutomation.js', () => ({
  runGuardedBatch: vi.fn(async (items, actionFn, options) => {
    if (options.dryRun !== false) {
      return {
        dryRun: true,
        total: items.length,
        results: items.map((item) => ({ target: item.toString(), ok: true, skipped: true })),
      };
    }
    const results = [];
    for (const item of items) {
      const r = await actionFn(item);
      results.push({ target: item.toString(), ...r });
    }
    return { dryRun: false, total: items.length, results };
  }),
}));

describe('messengerShareCampaign', () => {
  it('throws when postUrl is missing', async () => {
    const page = createMockPage();
    await expect(
      messengerShareCampaign(page, { postUrl: '', recipients: ['A'] }),
    ).rejects.toThrow(/postUrl is required/);
  });

  it('throws when recipients is empty', async () => {
    const page = createMockPage();
    await expect(
      messengerShareCampaign(page, { postUrl: 'https://fb.com/post/1', recipients: [] }),
    ).rejects.toThrow(/recipients must be a non-empty array/);
  });

  it('returns dry-run result by default', async () => {
    const page = createMockPage();
    const result = await messengerShareCampaign(page, {
      postUrl: 'https://fb.com/post/1',
      recipients: ['Page1', 'Page2'],
      content: 'Hello**World',
    });
    expect(result.dryRun).toBe(true);
    expect(result.total).toBe(2);
  });

  it('executes shares when dryRun=false', async () => {
    const page = createMockPage();
    const shareFn = vi.fn().mockResolvedValue({ ok: true, recipientName: 'Page1' });
    const result = await messengerShareCampaign(
      page,
      { postUrl: 'https://fb.com/post/1', recipients: ['Page1'], content: 'Hi' },
      { dryRun: false, shareFn, delay: () => Promise.resolve(), selectorTimeout: 100 },
    );
    expect(result.dryRun).toBe(false);
    expect(shareFn).toHaveBeenCalledTimes(1);
  });

  it('composes different messages per recipient via random segment', async () => {
    const page = createMockPage();
    const messages = [];
    const shareFn = vi.fn().mockImplementation(async (_page, target) => {
      messages.push(target.message);
      return { ok: true, recipientName: target.recipientName };
    });
    await messengerShareCampaign(
      page,
      { postUrl: 'https://fb.com/post/1', recipients: ['A', 'B', 'C'], content: 'Seg1**Seg2**Seg3' },
      { dryRun: false, shareFn, delay: () => Promise.resolve() },
    );
    // Each recipient gets a message (may be same or different due to randomness)
    expect(messages).toHaveLength(3);
    messages.forEach((m) => expect(['Seg1', 'Seg2', 'Seg3']).toContain(m));
  });
});

// ============================================================================
// SELECTORS constant
// ============================================================================

describe('SELECTORS', () => {
  it('exports all required selector keys', () => {
    const keys = Object.keys(SELECTORS);
    expect(keys).toContain('shareButton');
    expect(keys).toContain('sendInMessenger');
    expect(keys).toContain('recipientSearch');
    expect(keys).toContain('recipientRow');
    expect(keys).toContain('messageInput');
    expect(keys).toContain('sendButton');
    expect(keys).toContain('sendError');
    expect(keys).toContain('dialogClose');
  });
});
