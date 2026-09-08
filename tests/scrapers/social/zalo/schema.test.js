import { describe, it, expect } from 'vitest';
import { namespacedZaloId, parseZaloDate, stripHtml } from '../../../../src/scrapers/social/zalo/schema.js';

describe('Story 33.1: Zalo Schema Helpers', () => {
  it('namespacedZaloId creates correct format', () => {
    expect(namespacedZaloId('12345')).toBe('zalo:12345');
    expect(namespacedZaloId('p1', 'product')).toBe('zalo:product:p1');
  });

  it('parseZaloDate parses millisecond timestamps and dates', () => {
    const timestamp = 1725780000000;
    const d1 = parseZaloDate(timestamp);
    expect(d1).toBeInstanceOf(Date);
    expect(d1.getTime()).toBe(timestamp);

    const d2 = parseZaloDate('1725780000000');
    expect(d2).toBeInstanceOf(Date);
    expect(d2.getTime()).toBe(timestamp);

    const d3 = parseZaloDate('08/09/2026');
    expect(d3).toBeInstanceOf(Date);
    expect(d3.getUTCFullYear()).toBe(2026);
    expect(d3.getUTCMonth()).toBe(8); // 0-indexed September

    expect(parseZaloDate(null)).toBeNull();
    expect(parseZaloDate('')).toBeNull();
  });

  it('stripHtml cleans HTML markup and entities', () => {
    const html = '<p>Xin chào <b>Nowing AI</b> &amp; đối tác!</p>';
    expect(stripHtml(html)).toBe('Xin chào Nowing AI & đối tác!');
  });
});
