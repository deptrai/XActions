// by nichxbt
import { describe, it, expect } from 'vitest';
import { normalizeData } from '../../src/plugins/excel/index.js';

// normalizeData and formatCellValue are not exported directly from excel/index.js,
// but normalizeData is. extractHeaders and formatCellValue are internal helpers.
// We test normalizeData (exported) and indirectly cover the others via behavior.

// ============================================================================
// normalizeData (excel)
// ============================================================================

describe('normalizeData (excel)', () => {
  it('returns array as-is when input is already an array', () => {
    const input = [{ id: '1' }, { id: '2' }];
    expect(normalizeData(input)).toBe(input);
  });

  it('extracts followers key', () => {
    const input = { followers: [{ username: 'alice' }, { username: 'bob' }] };
    expect(normalizeData(input)).toEqual([{ username: 'alice' }, { username: 'bob' }]);
  });

  it('extracts following key', () => {
    const input = { following: [{ username: 'charlie' }] };
    expect(normalizeData(input)).toEqual([{ username: 'charlie' }]);
  });

  it('extracts tweets key', () => {
    const input = { tweets: [{ text: 'hello world' }] };
    expect(normalizeData(input)).toEqual([{ text: 'hello world' }]);
  });

  it('extracts likes key', () => {
    const input = { likes: [{ tweetId: 'abc' }] };
    expect(normalizeData(input)).toEqual([{ tweetId: 'abc' }]);
  });

  it('extracts results key', () => {
    const input = { results: [{ score: 99 }] };
    expect(normalizeData(input)).toEqual([{ score: 99 }]);
  });

  it('extracts users key', () => {
    const input = { users: [{ id: 'u1' }, { id: 'u2' }] };
    expect(normalizeData(input)).toEqual([{ id: 'u1' }, { id: 'u2' }]);
  });

  it('wraps plain object in array when no known key matches', () => {
    const input = { unknownKey: [1, 2, 3], name: 'test' };
    expect(normalizeData(input)).toEqual([input]);
  });

  it('handles empty array', () => {
    expect(normalizeData([])).toEqual([]);
  });

  it('ignores known key if its value is not an array', () => {
    // followers exists but is not an array — falls through to last-resort wrap
    const input = { followers: 'not-an-array' };
    expect(normalizeData(input)).toEqual([input]);
  });
});

// ============================================================================
// Plugin shape validation (structural smoke test)
// ============================================================================

describe('excel plugin exports', () => {
  it('exports required plugin fields', async () => {
    const plugin = await import('../../src/plugins/excel/index.js');
    expect(plugin.name).toBe('xactions-plugin-excel');
    expect(plugin.version).toBe('1.0.0');
    expect(typeof plugin.description).toBe('string');
    expect(Array.isArray(plugin.tools)).toBe(true);
    expect(Array.isArray(plugin.routes)).toBe(true);
    expect(typeof plugin.hooks).toBe('object');
  });

  it('exports 3 MCP tools', async () => {
    const plugin = await import('../../src/plugins/excel/index.js');
    expect(plugin.tools).toHaveLength(3);
    const toolNames = plugin.tools.map((t) => t.name);
    expect(toolNames).toContain('x_export_to_excel');
    expect(toolNames).toContain('x_export_multi_sheet_excel');
    expect(toolNames).toContain('x_read_from_excel');
  });

  it('each tool has name, description, inputSchema, and handler', async () => {
    const plugin = await import('../../src/plugins/excel/index.js');
    for (const tool of plugin.tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('exports 3 routes', async () => {
    const plugin = await import('../../src/plugins/excel/index.js');
    expect(plugin.routes).toHaveLength(3);
  });
});

// ============================================================================
// google-sheets plugin shape validation
// ============================================================================

describe('google-sheets plugin exports', () => {
  it('exports required plugin fields', async () => {
    const plugin = await import('../../src/plugins/google-sheets/index.js');
    expect(plugin.name).toBe('xactions-plugin-google-sheets');
    expect(plugin.version).toBe('1.0.0');
    expect(typeof plugin.description).toBe('string');
    expect(Array.isArray(plugin.tools)).toBe(true);
    expect(Array.isArray(plugin.routes)).toBe(true);
    expect(typeof plugin.hooks).toBe('object');
  });

  it('exports 3 MCP tools', async () => {
    const plugin = await import('../../src/plugins/google-sheets/index.js');
    expect(plugin.tools).toHaveLength(3);
    const toolNames = plugin.tools.map((t) => t.name);
    expect(toolNames).toContain('x_export_to_google_sheets');
    expect(toolNames).toContain('x_read_from_google_sheets');
    expect(toolNames).toContain('x_create_google_spreadsheet');
  });

  it('exports 3 routes', async () => {
    const plugin = await import('../../src/plugins/google-sheets/index.js');
    expect(plugin.routes).toHaveLength(3);
  });
});

// ============================================================================
// template plugin shape validation
// ============================================================================

describe('template plugin exports', () => {
  it('has correct name, version, and arrays', async () => {
    const plugin = await import('../../src/plugins/template/index.js');
    expect(plugin.name).toBe('xactions-plugin-example');
    expect(plugin.version).toBe('1.0.0');
    expect(Array.isArray(plugin.actions)).toBe(true);
    expect(Array.isArray(plugin.scrapers)).toBe(true);
    expect(Array.isArray(plugin.tools)).toBe(true);
    expect(Array.isArray(plugin.routes)).toBe(true);
    expect(typeof plugin.hooks).toBe('object');
  });

  it('hooks have onLoad and onUnload functions', async () => {
    const plugin = await import('../../src/plugins/template/index.js');
    expect(typeof plugin.hooks.onLoad).toBe('function');
    expect(typeof plugin.hooks.onUnload).toBe('function');
  });
});
