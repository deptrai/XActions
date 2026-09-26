// tests/scrapers/social/telegram/telegram.test.js
// Story 50.8 — telegram descriptor skeleton (transport deferred)
// by nichxbt

import { describe, it, expect } from 'vitest';
import { TelegramCrawler } from '../../../../src/scrapers/social/telegram/crawler.js';
import { TelegramClient } from '../../../../src/scrapers/social/telegram/client.js';
import telegramDescriptor from '../../../../src/scrapers/social/telegram/descriptor.js';
import { scrape, isSyncCapable } from '../../../../src/scrapers/index.js';
import { executeActionListTool } from '../../../../src/scrapers/social/actions-list.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

describe('Story 50.8 — telegram descriptor skeleton (transport deferred)', () => {
  it('T-1: TelegramCrawler instantiates; listActions returns 4 stubs with requiredArgs', () => {
    const crawler = new TelegramCrawler({});
    const actions = crawler.listActions();
    expect(actions).toHaveLength(4);
    const byAction = Object.fromEntries(actions.map(a => [a.action, a]));
    expect(byAction['channel_messages'].requiredArgs).toEqual(['channel']);
    expect(byAction['channel_info'].requiredArgs).toEqual(['channel']);
    expect(byAction['search_channels'].requiredArgs).toEqual(['query']);
    expect(byAction['user_resolve'].requiredArgs).toEqual(['username']);
    for (const a of actions) expect(a.category).toBe('social');
  });

  it('T-2: every client stub throws XACT_4001 "transport not implemented"', async () => {
    const client = new TelegramClient({});
    await expect(client.getChannelMessages('durov')).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });
    await expect(client.getChannelInfo('durov')).rejects.toMatchObject({ code: 'XACT_4001' });
    await expect(client.searchChannels('crypto')).rejects.toMatchObject({ code: 'XACT_4001' });
    await expect(client.resolveUser('durov')).rejects.toMatchObject({ code: 'XACT_4001' });
  });

  it('T-3: syncCapableActions = [] → isSyncCapable returns false for all actions', () => {
    for (const a of ['channel_messages', 'channel_info', 'search_channels', 'user_resolve']) {
      expect(isSyncCapable('telegram', a)).toBe(false);
    }
    expect(telegramDescriptor.syncCapableActions).toEqual([]);
  });

  it('T-4: /api/actions?platform=telegram lists 4 entries with status=coming_soon, syncCapable=false', async () => {
    const actions = await executeActionListTool({ platform: 'telegram' });
    expect(actions).toHaveLength(4);
    for (const a of actions) {
      expect(a.platform).toBe('telegram');
      expect(a.status).toBe('coming_soon');
      expect(a.syncCapable).toBe(false);
    }
  });

  it('T-5: scrape("telegram","channel_messages") rejects XACT_4001 (stub, no transport impl)', async () => {
    const client = new TelegramClient({});
    await expect(
      scrape('telegram', 'channel_messages', {
        channel: 'durov',
        client,
        autoClose: false,
      })
    ).rejects.toMatchObject({ code: 'XACT_4001' });
  });

  it('T-6: actionMap aliases resolve (posts/messages→channel_messages, user→user_resolve, search→search_channels)', () => {
    expect(telegramDescriptor.actionMap['posts']).toBe('channel_messages');
    expect(telegramDescriptor.actionMap['messages']).toBe('channel_messages');
    expect(telegramDescriptor.actionMap['search']).toBe('search_channels');
    expect(telegramDescriptor.actionMap['user']).toBe('user_resolve');
    expect(telegramDescriptor.actionMap['info']).toBe('channel_info');
  });

  it('T-7: invalid channel arg → XACT_4002 before transport check (deterministic validation)', async () => {
    const crawler = new TelegramCrawler({});
    await expect(crawler.fetchChannelInfo({ channel: 'x' })).rejects.toMatchObject({
      code: 'XACT_4002',
    });
    await expect(crawler.fetchUserResolve({ username: 'a@b!' })).rejects.toMatchObject({
      code: 'XACT_4002',
    });
  });
});
