// by nichxbt
import { describe, it, expect } from 'vitest';
import { normalizeData, toSheetRows } from '../../src/plugins/google-sheets/index.js';

// ============================================================================
// normalizeData
// ============================================================================

describe('normalizeData (google-sheets)', () => {
  it('returns the array as-is when input is already an array', () => {
    const input = [{ a: 1 }, { a: 2 }];
    expect(normalizeData(input)).toBe(input);
  });

  it('extracts a known wrapper key (followers)', () => {
    const input = { followers: [{ id: '1' }, { id: '2' }] };
    expect(normalizeData(input)).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('extracts a known wrapper key (tweets)', () => {
    const input = { tweets: [{ text: 'hello' }] };
    expect(normalizeData(input)).toEqual([{ text: 'hello' }]);
  });

  it('extracts results key when present', () => {
    const input = { results: [{ x: 1 }], other: 'ignored' };
    expect(normalizeData(input)).toEqual([{ x: 1 }]);
  });

  it('wraps a plain object in an array when no known key found', () => {
    const input = { foo: 'bar', baz: 42 };
    expect(normalizeData(input)).toEqual([input]);
  });

  it('handles empty array input', () => {
    expect(normalizeData([])).toEqual([]);
  });
});

// ============================================================================
// toSheetRows
// ============================================================================

describe('toSheetRows', () => {
  it('returns correct headers and rows for simple objects', () => {
    const items = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const { headers, rows } = toSheetRows(items);
    expect(headers).toContain('name');
    expect(headers).toContain('age');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Alice');
    expect(rows[0]).toContain(30);
  });

  it('uses explicit columns when provided', () => {
    const items = [{ name: 'Alice', age: 30, extra: 'ignored' }];
    const { headers, rows } = toSheetRows(items, ['name', 'age']);
    expect(headers).toEqual(['name', 'age']);
    expect(rows[0]).toEqual(['Alice', 30]);
  });

  it('replaces null/undefined with empty string', () => {
    const items = [{ name: null, age: undefined }];
    const { headers, rows } = toSheetRows(items, ['name', 'age']);
    expect(rows[0]).toEqual(['', '']);
  });

  it('joins array values with semicolon', () => {
    const items = [{ tags: ['a', 'b', 'c'] }];
    const { headers, rows } = toSheetRows(items, ['tags']);
    expect(rows[0][0]).toBe('a; b; c');
  });

  it('JSON-stringifies nested objects', () => {
    const nested = { x: 1 };
    const items = [{ meta: nested }];
    const { headers, rows } = toSheetRows(items, ['meta']);
    expect(rows[0][0]).toBe(JSON.stringify(nested));
  });

  it('returns empty rows for empty items array', () => {
    const { headers, rows } = toSheetRows([], ['name']);
    expect(headers).toEqual(['name']);
    expect(rows).toHaveLength(0);
  });

  it('collects union of all keys across all items', () => {
    const items = [{ a: 1 }, { b: 2 }];
    const { headers } = toSheetRows(items);
    expect(headers).toContain('a');
    expect(headers).toContain('b');
  });
});
