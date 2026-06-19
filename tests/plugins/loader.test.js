// by nichxbt
import { describe, it, expect } from 'vitest';
import { isValidPluginName, validatePlugin } from '../../src/plugins/loader.js';

// ============================================================================
// isValidPluginName
// ============================================================================

describe('isValidPluginName', () => {
  it('accepts xactions-plugin-* names', () => {
    expect(isValidPluginName('xactions-plugin-analytics')).toBe(true);
    expect(isValidPluginName('xactions-plugin-excel')).toBe(true);
    expect(isValidPluginName('xactions-plugin-google-sheets')).toBe(true);
  });

  it('accepts @xactions/* scoped names', () => {
    expect(isValidPluginName('@xactions/excel')).toBe(true);
    expect(isValidPluginName('@xactions/my-plugin')).toBe(true);
  });

  it('rejects arbitrary npm package names', () => {
    expect(isValidPluginName('lodash')).toBe(false);
    expect(isValidPluginName('my-cool-plugin')).toBe(false);
    expect(isValidPluginName('xactions')).toBe(false); // no suffix
  });

  it('rejects empty string', () => {
    expect(isValidPluginName('')).toBe(false);
  });

  it('rejects names that only partially match', () => {
    expect(isValidPluginName('not-xactions-plugin-foo')).toBe(false);
    expect(isValidPluginName('@notxactions/foo')).toBe(false);
  });
});

// ============================================================================
// validatePlugin
// ============================================================================

describe('validatePlugin', () => {
  const validPlugin = {
    name: 'xactions-plugin-test',
    version: '1.0.0',
  };

  it('passes for a minimal valid plugin (name + version only)', () => {
    const { valid, errors } = validatePlugin(validPlugin);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('passes for a fully-specified valid plugin', () => {
    const { valid, errors } = validatePlugin({
      name: 'xactions-plugin-full',
      version: '2.3.1',
      description: 'A full plugin',
      actions: [{ name: 'doThing', script: '(() => {})()' }],
      scrapers: [{ name: 'scrapeX', handler: async () => [] }],
      tools: [{ name: 'x_tool', description: 'A tool', inputSchema: {} }],
      routes: [{ method: 'get', path: '/foo', handler: () => {} }],
      hooks: { onLoad() {}, onUnload() {} },
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('fails when name is missing', () => {
    const { valid, errors } = validatePlugin({ version: '1.0.0' });
    expect(valid).toBe(false);
    expect(errors).toContain('Plugin must export a "name" string');
  });

  it('fails when version is missing', () => {
    const { valid, errors } = validatePlugin({ name: 'xactions-plugin-test' });
    expect(valid).toBe(false);
    expect(errors).toContain('Plugin must export a "version" string');
  });

  it('fails when both name and version are missing', () => {
    const { valid, errors } = validatePlugin({});
    expect(valid).toBe(false);
    expect(errors).toHaveLength(2);
  });

  it('fails when actions is not an array', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, actions: 'bad' });
    expect(valid).toBe(false);
    expect(errors).toContain('"actions" must be an array');
  });

  it('fails when scrapers is not an array', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, scrapers: 42 });
    expect(valid).toBe(false);
    expect(errors).toContain('"scrapers" must be an array');
  });

  it('fails when tools is not an array', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, tools: {} });
    expect(valid).toBe(false);
    expect(errors).toContain('"tools" must be an array');
  });

  it('fails when routes is not an array', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, routes: true });
    expect(valid).toBe(false);
    expect(errors).toContain('"routes" must be an array');
  });

  it('fails when hooks is not an object (e.g., a string)', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, hooks: 'bad' });
    expect(valid).toBe(false);
    expect(errors).toContain('"hooks" must be an object');
  });

  it('allows empty arrays for optional fields', () => {
    const { valid, errors } = validatePlugin({
      ...validPlugin,
      actions: [],
      scrapers: [],
      tools: [],
      routes: [],
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });
});
