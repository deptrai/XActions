// tests/scrapers/adapters/base.test.js
// Contract tests for BaseAdapter: connect, setCookies, and not-implemented guards.

import { describe, it, expect, vi } from 'vitest';
import { BaseAdapter } from '../../../src/scrapers/adapters/base.js';

class ThrowingAdapter extends BaseAdapter {
  name = 'throwing';
  description = 'Throws on all abstract methods';
}

class CookieAdapter extends BaseAdapter {
  name = 'cookie';
  description = 'Records cookies';

  constructor() {
    super();
    this.cookies = [];
  }

  async setCookie(page, cookie) {
    this.cookies.push(cookie);
  }
}

describe('BaseAdapter contract', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new BaseAdapter()).toThrow(/abstract/i);
  });

  it('throws not implemented for all abstract methods', async () => {
    const adapter = new ThrowingAdapter();

    await expect(adapter.checkDependencies()).rejects.toThrow(/not implemented/);
    await expect(adapter.launch({})).rejects.toThrow(/not implemented/);
    await expect(adapter.newPage({}, {})).rejects.toThrow(/not implemented/);
    await expect(adapter.goto({}, 'https://example.com')).rejects.toThrow(/not implemented/);
    await expect(adapter.evaluate({}, () => {})).rejects.toThrow(/not implemented/);
    await expect(adapter.queryAll({}, 'div')).rejects.toThrow(/not implemented/);
    await expect(adapter.getContent({})).rejects.toThrow(/not implemented/);
    await expect(adapter.setCookie({}, { name: 'x', value: 'y' })).rejects.toThrow(/not implemented/);
    await expect(adapter.scroll({})).rejects.toThrow(/not implemented/);
    await expect(adapter.screenshot({})).rejects.toThrow(/not implemented/);
    await expect(adapter.waitForSelector({}, 'div')).rejects.toThrow(/not implemented/);
    await expect(adapter.closePage({})).rejects.toThrow(/not implemented/);
    await expect(adapter.closeBrowser({})).rejects.toThrow(/not implemented/);
    await expect(adapter.connect('http://localhost:9222')).rejects.toThrow(/not implemented/);
  });

  it('setCookies delegates to setCookie for each cookie', async () => {
    const adapter = new CookieAdapter();
    const page = {};

    await adapter.setCookies(page, [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);

    expect(adapter.cookies).toHaveLength(2);
    expect(adapter.cookies[0]).toEqual({ name: 'a', value: '1' });
    expect(adapter.cookies[1]).toEqual({ name: 'b', value: '2' });
  });

  it('getInfo returns adapter metadata', () => {
    const adapter = new CookieAdapter();
    expect(adapter.getInfo()).toEqual({
      name: 'cookie',
      description: 'Records cookies',
      supportsJavaScript: false,
      requiresBrowser: false,
    });
  });
});
