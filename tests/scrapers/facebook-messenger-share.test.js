// tests/scrapers/facebook-messenger-share.test.js
// P1 Kill: mutation tests for messengerShare.js pure functions + browser seams.
import { describe, it, expect, vi } from 'vitest';
import {
  stripEmojiSurrogates,
  pickRandomSegment,
  composeMessage,
  typeMessage,
  sendMessageToThread,
  shareToMessenger,
  messengerShareCampaign,
  SELECTORS,
} from '../../src/scrapers/facebook/messengerShare.js';
import { makeFakePage } from '../helpers/fake-page.js';

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

// ============================================================================
// P1 Kill: pickRandomSegment — random distribution (L120, L121)
// ============================================================================

describe('pickRandomSegment — random distribution (P1 kill, L120-121)', () => {
  // Override Math.random to control segment selection
  const originalRandom = Math.random;

  afterEach(() => {
    Math.random = originalRandom;
  });

  it('with 2 segments and random=0.5 → picks segment[1] (not always first)', () => {
    Math.random = () => 0.5;
    // Math.floor(0.5 * 2) = 1 → segments[1]
    expect(pickRandomSegment('first**second')).toBe('second');
  });

  it('with 2 segments and random=0.0 → picks segment[0]', () => {
    Math.random = () => 0.0;
    // Math.floor(0.0 * 2) = 0 → segments[0]
    expect(pickRandomSegment('first**second')).toBe('first');
  });

  it('with 3 segments and random=0.9 → picks segment[2]', () => {
    Math.random = () => 0.9;
    // Math.floor(0.9 * 3) = 2 → segments[2]
    expect(pickRandomSegment('a**b**c')).toBe('c');
  });

  it('with 3 segments and random=0.3 → picks segment[0]', () => {
    Math.random = () => 0.3;
    // Math.floor(0.3 * 3) = 0 → segments[0]
    expect(pickRandomSegment('a**b**c')).toBe('a');
  });

  it('ArithmeticOperator mutant: / instead of * → always segment[0] (L121)', () => {
    // Math.floor(0.5 / 2) = 0 → always segment[0]
    // Original: Math.floor(0.5 * 2) = 1 → segment[1]
    Math.random = () => 0.5;
    expect(pickRandomSegment('first**second')).toBe('second');
  });

  it('ConditionalExpression mutant L120: true → always returns segments[0]', () => {
    Math.random = () => 0.99;
    // Original: segments.length=2, idx=1 → 'second'
    // Mutant (true): always return segments[0] → 'first'
    expect(pickRandomSegment('first**second')).toBe('second');
  });
});

// ============================================================================
// P1 Kill: composeMessage — default stripEmoji (L135)
// ============================================================================

describe('composeMessage — default stripEmoji (P1 kill, L135)', () => {
  it('default options strip emoji (L135: stripEmoji = true)', () => {
    // BooleanLiteral mutant L135: true → false → emoji NOT stripped by default
    const result = composeMessage('hello 😀 world');
    expect(result).not.toContain('😀');
  });

  it('whitespace normalization (L146: /[ \\t]+/g → " ")', () => {
    // MethodExpression mutant L146: no replace → spaces preserved
    const result = composeMessage('hello     world', { stripEmoji: false });
    expect(result).toBe('hello world');
    expect(result).not.toContain('  ');
  });

  it('newline collapse (L146: /\\n{3,}/g → "\\n\\n")', () => {
    // MethodExpression mutant L146: no replace → 3+ newlines preserved
    const result = composeMessage('a\n\n\n\nb', { stripEmoji: false });
    expect(result).toBe('a\n\nb');
  });

  it('typeof guard with non-string from picker (L139: typeof message !== "string")', () => {
    // ConditionalExpression mutant L139: false → skip guard → .replace() throws
    const numPicker = () => 42;
    expect(() => composeMessage('test', { segmentPicker: numPicker, stripEmoji: false })).not.toThrow();
  });

  it('typeof guard with null from picker → empty string (L139-140)', () => {
    const nullPicker = () => null;
    expect(composeMessage('test', { segmentPicker: nullPicker, stripEmoji: false })).toBe('');
  });
});

// ============================================================================
// P1 Kill: typeMessage — empty lines + delay (L173, L174)
// ============================================================================

describe('typeMessage — empty lines + delay (P1 kill, L173-174)', () => {
  function makeFakePage() {
    const keyboard = {
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
      press: vi.fn(async () => {}),
      type: vi.fn(async () => {}),
    };
    return { keyboard };
  }

  it('skips empty lines (L173: if (lines[i]))', () => {
    // ConditionalExpression mutant L173: true → always type, even empty lines
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    // 'a\n\nb' → lines = ['a', '', 'b']
    // Original: skip '' → type called 2 times
    // Mutant (true): type '' too → type called 3 times
    return typeMessage(page, 'a\n\nb', { delay }).then(() => {
      expect(page.keyboard.type).toHaveBeenCalledTimes(2);
    });
  });

  it('type delay is in range [20, 50] (L174: 20 + random * 30)', () => {
    // ArithmeticOperator mutant L174: / instead of * → delay ≈ 20 (always)
    // Original: delay = 20 + random * 30 → [20, 50]
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    return typeMessage(page, 'hello', { delay }).then(() => {
      const opts = page.keyboard.type.mock.calls[0][1];
      // Mutant /: 20 + 0.5/30 ≈ 20.017 → always ~20
      // Original: 20 + 0.5*30 = 35
      // To kill: assert delay > 20 (not just >= 20)
      expect(opts.delay).toBeGreaterThan(20);
      expect(opts.delay).toBeLessThanOrEqual(50);
    });
  });

  it('types all non-empty lines in multi-line message', async () => {
    const page = makeFakePage();
    const delay = vi.fn(async () => {});
    await typeMessage(page, 'line1\nline2\nline3', { delay });
    expect(page.keyboard.type).toHaveBeenCalledTimes(3);
    expect(page.keyboard.type).toHaveBeenNthCalledWith(1, 'line1', expect.any(Object));
    expect(page.keyboard.type).toHaveBeenNthCalledWith(2, 'line2', expect.any(Object));
    expect(page.keyboard.type).toHaveBeenNthCalledWith(3, 'line3', expect.any(Object));
  });
});

// ============================================================================
// sendMessageToThread (L310-390) — fake page with DOM state
// ============================================================================

describe('sendMessageToThread (P1 kill, fake page)', () => {
  const delay = vi.fn(async () => {});

  it('returns ok:true when message is empty (L316: !message)', async () => {
    const page = makeFakePage();
    const result = await sendMessageToThread(page, 'Alice', '', { delay });
    expect(result).toEqual({ ok: true });
  });

  it('navigates to messages URL when not on /messages/ (L320-321)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/home' });
    // Set up eval to return true for thread click
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) {
        return true; // opened thread
      }
      if (fnStr.includes('btns') && fnStr.includes('aria-label')) {
        return 'Press Enter to send'; // sent button
      }
      return null;
    };
    page.$ = async (sel) => {
      if (sel.includes('contenteditable')) {
        return { type: async () => {} };
      }
      return null;
    };
    const result = await sendMessageToThread(page, 'Alice', 'hello', { delay });
    expect(page.calls.goto.length).toBeGreaterThanOrEqual(1);
    expect(result.ok).toBe(true);
  });

  it('does NOT navigate when already on /messages/ (L320)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/messages/t/alice' });
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) return true;
      if (fnStr.includes('btns') && fnStr.includes('aria-label')) return 'Press Enter to send';
      return null;
    };
    page.$ = async (sel) => {
      if (sel.includes('contenteditable')) return { type: async () => {} };
      return null;
    };
    await sendMessageToThread(page, 'Alice', 'hello', { delay });
    expect(page.calls.goto).toHaveLength(0);
  });

  it('returns ok:false when thread not found (L334-335)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/messages/t/' });
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) return false; // not found
      return null;
    };
    const result = await sendMessageToThread(page, 'Ghost', 'hello', { delay });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns ok:false when compose box not found (L346-347)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/messages/t/' });
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) return true;
      return null;
    };
    page.$ = async () => null; // no compose box
    const result = await sendMessageToThread(page, 'Alice', 'hello', { delay, selectorTimeout: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('compose box');
  });

  it('types message into compose box and sends (L349-386)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/messages/t/' });
    const typedTexts = [];
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) return true;
      if (fnStr.includes('btns') && fnStr.includes('aria-label')) return 'Press Enter to send';
      return null;
    };
    page.$ = async (sel) => {
      if (sel.includes('contenteditable')) {
        return { type: async (text, opts) => { typedTexts.push(text); } };
      }
      return null;
    };
    const result = await sendMessageToThread(page, 'Alice', 'hello world', { delay });
    expect(result.ok).toBe(true);
    expect(result.sentVia).toBe('Press Enter to send');
    expect(typedTexts).toContain('hello world');
  });

  it('falls back to Enter when send button not found (L380-383)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/messages/t/' });
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) return true;
      if (fnStr.includes('btns') && fnStr.includes('aria-label')) return null; // no send button
      return null;
    };
    page.$ = async (sel) => {
      if (sel.includes('contenteditable')) return { type: async () => {} };
      return null;
    };
    const result = await sendMessageToThread(page, 'Alice', 'hello', { delay });
    expect(result.ok).toBe(true);
    expect(result.sentVia).toBe('enter-fallback');
    expect(page.calls.keyboard.press).toContain('Enter');
  });

  it('multi-line message uses Shift+Enter (L351-355)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/messages/t/' });
    page.evaluate = async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('needleLc') && fnStr.includes('links')) return true;
      if (fnStr.includes('btns') && fnStr.includes('aria-label')) return 'Press Enter to send';
      return null;
    };
    page.$ = async (sel) => {
      if (sel.includes('contenteditable')) return { type: async () => {} };
      return null;
    };
    await sendMessageToThread(page, 'Alice', 'line1\nline2', { delay });
    expect(page.calls.keyboard.down).toContain('Shift');
    expect(page.calls.keyboard.up).toContain('Shift');
    expect(page.calls.keyboard.press).toContain('Enter');
  });

  it('catch block returns ok:false with error message (L387-388)', async () => {
    const page = makeFakePage({ currentUrl: 'https://www.facebook.com/home' });
    page.goto = async () => { throw new Error('Network error'); };
    const result = await sendMessageToThread(page, 'Alice', 'hello', { delay });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

// ============================================================================
// shareToMessenger (L420-503) — fake page with DOM state
// ============================================================================

describe('shareToMessenger (P1 kill, fake page)', () => {
  const delay = vi.fn(async () => {});

  it('returns ok:false when missing recipientName or postUrl (L428-429)', async () => {
    const page = makeFakePage();
    const result = await shareToMessenger(page, { postUrl: 'https://facebook.com/post/1' }, { delay });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing/);
  });

  it('returns ok:false when recipientName missing (L428-429)', async () => {
    const page = makeFakePage();
    const result = await shareToMessenger(page, { recipientName: 'Alice' }, { delay });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing/);
  });

  it('returns ok:false when share button not found (L440-444)', async () => {
    const page = makeFakePage();
    page.$ = async () => null;
    page.$x = async () => [];
    const result = await shareToMessenger(
      page,
      { recipientName: 'Alice', postUrl: 'https://facebook.com/post/1', message: 'hi' },
      { delay, selectorTimeout: 100 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/share|button/i);
  });
});

// ============================================================================
// messengerShareCampaign (L530-573) — batch orchestration
// ============================================================================

describe('messengerShareCampaign (P1 kill)', () => {
  it('throws when postUrl is missing (L543-544)', async () => {
    const page = makeFakePage();
    await expect(messengerShareCampaign(page, { recipients: ['Alice'] })).rejects.toThrow(/postUrl/);
  });

  it('throws when recipients is empty or not array (L546-547)', async () => {
    const page = makeFakePage();
    await expect(messengerShareCampaign(page, { postUrl: 'https://fb.com/p/1', recipients: [] })).rejects.toThrow(/recipients/);
    await expect(messengerShareCampaign(page, { postUrl: 'https://fb.com/p/1', recipients: null })).rejects.toThrow(/recipients/);
  });

  it('dryRun=true returns preview without executing (L570)', async () => {
    const page = makeFakePage();
    const result = await messengerShareCampaign(
      page,
      { postUrl: 'https://facebook.com/post/1', recipients: ['Alice', 'Bob'], content: 'hello' },
      { dryRun: true },
    );
    expect(result.dryRun).toBe(true);
    expect(result.preview).toHaveLength(2);
    // preview items are { target: item, action: 'pending' } — target is the item object
    expect(result.preview[0].target.recipientName).toBe('Alice');
    expect(result.preview[1].target.recipientName).toBe('Bob');
  });

  it('dryRun=true with no content → empty message (L553: content ? composeFn : "")', async () => {
    const page = makeFakePage();
    const result = await messengerShareCampaign(
      page,
      { postUrl: 'https://facebook.com/post/1', recipients: ['Alice'], content: '' },
      { dryRun: true },
    );
    expect(result.preview).toHaveLength(1);
    expect(result.preview[0].target.message).toBe('');
  });
});
