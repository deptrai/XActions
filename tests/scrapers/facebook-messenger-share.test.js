// tests/scrapers/facebook-messenger-share.test.js
// P1 Kill: mutation tests for messengerShare.js pure functions + browser seams.
import { describe, it, expect, vi } from 'vitest';
import {
  stripEmojiSurrogates,
  pickRandomSegment,
  composeMessage,
  typeMessage,
  SELECTORS,
} from '../../src/scrapers/facebook/messengerShare.js';

// ============================================================================
// stripEmojiSurrogates (L101-106)
// ============================================================================

describe('stripEmojiSurrogates (P1 kill)', () => {
  it('returns empty string for falsy input (L102: !text)', () => {
    expect(stripEmojiSurrogates('')).toBe('');
    expect(stripEmojiSurrogates(null)).toBe('');
    expect(stripEmojiSurrogates(undefined)).toBe('');
    expect(stripEmojiSurrogates(0)).toBe('');
  });

  it('removes astral plane emoji (L105: /[\\u{10000}-\\u{10FFFF}]/gu)', () => {
    // 😀 is U+1F600 (astral plane)
    const result = stripEmojiSurrogates('hello 😀 world');
    expect(result).toBe('hello  world');
    expect(result).not.toContain('😀');
  });

  it('preserves BMP characters (L105)', () => {
    // BMP characters (U+0000 to U+FFFF) should be preserved
    expect(stripEmojiSurrogates('café résumé')).toBe('café résumé');
    expect(stripEmojiSurrogates('日本語')).toBe('日本語');
  });

  it('trims whitespace after removing emoji (L105: .trim())', () => {
    expect(stripEmojiSurrogates('  😀  ')).toBe('');
    expect(stripEmojiSurrogates('  hello 😀  ')).toBe('hello');
  });

  it('handles string with only emoji → empty after trim', () => {
    expect(stripEmojiSurrogates('😀🎉🚀')).toBe('');
  });

  it('preserves regular text without emoji', () => {
    expect(stripEmojiSurrogates('hello world')).toBe('hello world');
  });
});

// ============================================================================
// pickRandomSegment (L116-123)
// ============================================================================

describe('pickRandomSegment (P1 kill)', () => {
  it('returns empty string for falsy input (L117: !text)', () => {
    expect(pickRandomSegment('')).toBe('');
    expect(pickRandomSegment(null)).toBe('');
    expect(pickRandomSegment(undefined)).toBe('');
  });

  it('returns empty string when all segments are empty (L119: segments.length === 0)', () => {
    expect(pickRandomSegment('**')).toBe('');
    expect(pickRandomSegment('  **  ')).toBe('');
    expect(pickRandomSegment('')).toBe('');
  });

  it('returns single segment when only one (L120: segments.length === 1)', () => {
    expect(pickRandomSegment('hello')).toBe('hello');
    expect(pickRandomSegment('  hello  ')).toBe('hello'); // trimmed
  });

  it('returns one of multiple segments (L121-122)', () => {
    const text = 'option1**option2**option3';
    const result = pickRandomSegment(text);
    expect(['option1', 'option2', 'option3']).toContain(result);
  });

  it('trims each segment (L118: .map(s => s.trim()))', () => {
    const text = '  hello  **  world  ';
    const result = pickRandomSegment(text);
    expect(['hello', 'world']).toContain(result);
  });

  it('filters out empty segments (L118: .filter(Boolean))', () => {
    const text = 'hello****world';
    const result = pickRandomSegment(text);
    expect(['hello', 'world']).toContain(result);
  });

  it('handles segments with only whitespace → filtered out', () => {
    const text = 'hello**   **world';
    const result = pickRandomSegment(text);
    expect(['hello', 'world']).toContain(result);
  });

  it('single segment with only whitespace → empty (L119)', () => {
    expect(pickRandomSegment('   ')).toBe('');
  });
});

// ============================================================================
// composeMessage (L134-147)
// ============================================================================

describe('composeMessage (P1 kill)', () => {
  it('composes message with default options (stripEmoji=true, pickRandomSegment)', () => {
    const result = composeMessage('hello world');
    expect(result).toBe('hello world');
  });

  it('picks random segment from ** delimited content (L136: segmentPicker)', () => {
    const result = composeMessage('option1**option2');
    expect(['option1', 'option2']).toContain(result);
  });

  it('strips emoji when stripEmoji=true (L142-143)', () => {
    const result = composeMessage('hello 😀 world', { stripEmoji: true });
    expect(result).not.toContain('😀');
    // Note: composeMessage also normalizes whitespace, so double space → single
    expect(result).toBe('hello world');
  });

  it('does NOT strip emoji when stripEmoji=false (L142)', () => {
    const result = composeMessage('hello 😀 world', { stripEmoji: false });
    expect(result).toContain('😀');
  });

  it('normalizes spaces and tabs (L146: /[ \\t]+/g → " ")', () => {
    const result = composeMessage('hello     world\t\tfoo', { stripEmoji: false });
    expect(result).toBe('hello world foo');
  });

  it('collapses 3+ newlines to 2 (L146: /\\n{3,}/g → "\\n\\n")', () => {
    const result = composeMessage('line1\n\n\n\nline2', { stripEmoji: false });
    expect(result).toBe('line1\n\nline2');
  });

  it('preserves 2 newlines (L146: \\n{3,} boundary)', () => {
    const result = composeMessage('line1\n\nline2', { stripEmoji: false });
    expect(result).toBe('line1\n\nline2');
  });

  it('preserves single newline (L146)', () => {
    const result = composeMessage('line1\nline2', { stripEmoji: false });
    expect(result).toBe('line1\nline2');
  });

  it('trims final result (L146: .trim())', () => {
    const result = composeMessage('  hello  ', { stripEmoji: false });
    expect(result).toBe('hello');
  });

  it('handles non-string segment picker output — null → empty (L139-140)', () => {
    const nullPicker = () => null;
    expect(composeMessage('test', { segmentPicker: nullPicker, stripEmoji: false })).toBe('');
  });

  it('handles non-string segment picker output — undefined → empty (L139-140)', () => {
    const undefPicker = () => undefined;
    expect(composeMessage('test', { segmentPicker: undefPicker, stripEmoji: false })).toBe('');
  });

  it('handles non-string segment picker output — number → String(number) (L140)', () => {
    const numPicker = () => 42;
    expect(composeMessage('test', { segmentPicker: numPicker, stripEmoji: false })).toBe('42');
  });

  it('handles non-string segment picker output — object → String(object) (L140)', () => {
    const objPicker = () => ({ foo: 'bar' });
    expect(composeMessage('test', { segmentPicker: objPicker, stripEmoji: false })).toBe('[object Object]');
  });

  it('typeof message !== "string" guard catches non-string (L139)', () => {
    const boolPicker = () => true;
    expect(composeMessage('test', { segmentPicker: boolPicker, stripEmoji: false })).toBe('true');
  });

  it('custom segmentPicker is used (L135: segmentPicker = pickRandomSegment)', () => {
    const customPicker = (text) => `custom:${text}`;
    expect(composeMessage('hello', { segmentPicker: customPicker, stripEmoji: false })).toBe('custom:hello');
  });
});

// ============================================================================
// typeMessage (L162-187) — browser seam with fake page
// ============================================================================

describe('typeMessage (P1 kill, fake page)', () => {
  function makeFakePage() {
    const calls = [];
    const keyboard = {
      down: vi.fn(async (key) => { calls.push(`down:${key}`); }),
      up: vi.fn(async (key) => { calls.push(`up:${key}`); }),
      press: vi.fn(async (key) => { calls.push(`press:${key}`); }),
      type: vi.fn(async (text, opts) => { calls.push(`type:${text}:${JSON.stringify(opts)}`); }),
    };
    return { keyboard, calls };
  }

  it('types single-line message (no Shift+Enter)', async () => {
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    await typeMessage(page, 'hello', { delay });
    expect(page.keyboard.type).toHaveBeenCalledWith('hello', expect.any(Object));
    expect(page.keyboard.down).not.toHaveBeenCalled();
  });

  it('types multi-line message with Shift+Enter between lines', async () => {
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    await typeMessage(page, 'line1\nline2\nline3', { delay });
    // 3 lines → 2 Shift+Enter presses
    expect(page.keyboard.down).toHaveBeenCalledTimes(2);
    expect(page.keyboard.up).toHaveBeenCalledTimes(2);
    expect(page.keyboard.press).toHaveBeenCalledTimes(2);
    expect(page.keyboard.type).toHaveBeenCalledTimes(3);
  });

  it('calls delay between lines (L165-186)', async () => {
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    await typeMessage(page, 'a\nb', { delay });
    // delay called after each line (except maybe last)
    expect(delay).toHaveBeenCalled();
  });

  it('uses default delay if not provided (L163)', async () => {
    const page = makeFakePage();
    // Should not throw with default delay
    await expect(typeMessage(page, 'hello')).resolves.not.toThrow();
  });

  it('type delay is 20 + random * 30 (L174: ObjectLiteral + ArithmeticOperator)', async () => {
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    await typeMessage(page, 'hello', { delay });
    const opts = page.keyboard.type.mock.calls[0][1];
    expect(opts).toHaveProperty('delay');
    expect(opts.delay).toBeGreaterThanOrEqual(20);
    expect(opts.delay).toBeLessThanOrEqual(50);
  });
});

// ============================================================================
// SELECTORS export (L54)
// ============================================================================

describe('SELECTORS (P1 kill)', () => {
  it('exports expected selector keys', () => {
    expect(SELECTORS).toHaveProperty('messagesUrl');
    expect(SELECTORS).toHaveProperty('threadComposeBox');
  });

  it('messagesUrl contains facebook.com', () => {
    expect(SELECTORS.messagesUrl).toContain('facebook.com');
  });
});
