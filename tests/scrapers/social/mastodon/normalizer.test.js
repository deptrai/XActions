// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Unit tests for Mastodon Normalizer & Resolver (Story 23.4).
 * Tests URL normalization, WebFinger target resolution, HTML entity decoding,
 * Link header pagination parsing, and Account/Status/Tag mapping.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeInstanceUrl,
  extractInstanceHost,
  namespacedMastodonId,
  toPlainText,
  resolveMastodonTarget,
  parseLinkHeader,
  normalizeMastodonAccount,
  profileItemToPostItem,
  normalizeMastodonStatus,
  normalizeMastodonTag,
} from '../../../../src/scrapers/social/mastodon/normalizer.js';
import { CATEGORIES } from '../../../../src/core/types.js';

describe('Story 23.4 — Mastodon Normalizer', () => {
  describe('normalizeInstanceUrl', () => {
    it('normalizes raw domain without scheme', () => {
      expect(normalizeInstanceUrl('mastodon.social')).toBe('https://mastodon.social');
      expect(normalizeInstanceUrl('fosstodon.org/')).toBe('https://fosstodon.org');
    });

    it('preserves existing https scheme and lowercases', () => {
      expect(normalizeInstanceUrl('HTTPS://Mastodon.Art/path/')).toBe('https://mastodon.art');
    });

    it('falls back to default instance when empty', () => {
      expect(normalizeInstanceUrl('')).toBe('https://mastodon.social');
      expect(normalizeInstanceUrl(null)).toBe('https://mastodon.social');
    });
  });

  describe('resolveMastodonTarget', () => {
    it('resolves clean username with default instance', () => {
      const res = resolveMastodonTarget('Gargron');
      expect(res.username).toBe('Gargron');
      expect(res.instance).toBe('https://mastodon.social');
      expect(res.acct).toBe('Gargron@mastodon.social');
    });

    it('resolves leading @ username', () => {
      const res = resolveMastodonTarget('@Gargron', 'https://fosstodon.org');
      expect(res.username).toBe('Gargron');
      expect(res.instance).toBe('https://fosstodon.org');
      expect(res.acct).toBe('Gargron@fosstodon.org');
    });

    it('resolves WebFinger handle @user@instance', () => {
      const res = resolveMastodonTarget('@alice@infosec.exchange');
      expect(res.username).toBe('alice');
      expect(res.instance).toBe('https://infosec.exchange');
      expect(res.acct).toBe('alice@infosec.exchange');
    });

    it('resolves WebFinger handle user@instance without leading @', () => {
      const res = resolveMastodonTarget('bob@techhub.social');
      expect(res.username).toBe('bob');
      expect(res.instance).toBe('https://techhub.social');
      expect(res.acct).toBe('bob@techhub.social');
    });

    it('resolves profile URL https://instance/@user', () => {
      const res = resolveMastodonTarget('https://mastodon.social/@Gargron');
      expect(res.username).toBe('Gargron');
      expect(res.instance).toBe('https://mastodon.social');
      expect(res.acct).toBe('Gargron@mastodon.social');
    });

    it('resolves profile URL https://instance/users/user', () => {
      const res = resolveMastodonTarget('https://fosstodon.org/users/kevin');
      expect(res.username).toBe('kevin');
      expect(res.instance).toBe('https://fosstodon.org');
      expect(res.acct).toBe('kevin@fosstodon.org');
    });

    it('throws on empty or invalid input', () => {
      expect(() => resolveMastodonTarget('')).toThrow(/non-empty string/);
      expect(() => resolveMastodonTarget('   ')).toThrow(/non-empty string/);
      expect(() => resolveMastodonTarget('user with spaces')).toThrow(/format/);
    });
  });

  describe('toPlainText', () => {
    it('strips HTML tags and preserves newlines', () => {
      const html = '<p>First paragraph</p><p>Second paragraph<br>with break</p>';
      const text = toPlainText(html);
      expect(text).toBe('First paragraph\n\nSecond paragraph\nwith break');
    });

    it('decodes common HTML entities including quotes and ampersands', () => {
      const html = 'Hello &amp; welcome to &quot;Mastodon&#39;s&quot; &lt;federation&gt;! &apos;cool&apos;&nbsp;spaces';
      const text = toPlainText(html);
      expect(text).toBe("Hello & welcome to \"Mastodon's\" <federation>! 'cool' spaces");
    });

    it('returns null for null, undefined, or empty string', () => {
      expect(toPlainText(null)).toBeNull();
      expect(toPlainText(undefined)).toBeNull();
      expect(toPlainText('')).toBeNull();
    });
  });

  describe('parseLinkHeader', () => {
    it('extracts max_id from standard Link header', () => {
      const header = '<https://mastodon.social/api/v1/timelines/home?max_id=10935123>; rel="next", <https://mastodon.social/api/v1/timelines/home?since_id=10935555>; rel="prev"';
      expect(parseLinkHeader(header)).toBe('10935123');
    });

    it('returns null if rel=next is missing or has no max_id', () => {
      const header = '<https://mastodon.social/api/v1/timelines/home?since_id=10935555>; rel="prev"';
      expect(parseLinkHeader(header)).toBeNull();
      expect(parseLinkHeader(null)).toBeNull();
      expect(parseLinkHeader('')).toBeNull();
    });
  });

  describe('namespacedMastodonId', () => {
    it('creates standard namespaced ID', () => {
      expect(namespacedMastodonId('https://mastodon.social', '12345')).toBe('mastodon:mastodon.social:12345');
      expect(namespacedMastodonId('fosstodon.org', 6789)).toBe('mastodon:fosstodon.org:6789');
    });
  });

  describe('normalizeMastodonAccount', () => {
    it('maps account fields into ProfileItem', () => {
      const raw = {
        id: '1093',
        username: 'Gargron',
        acct: 'Gargron',
        display_name: 'Eugen Rochko',
        note: '<p>Founder of &quot;Mastodon&quot;<br>Building decentralized web.</p>',
        url: 'https://mastodon.social/@Gargron',
        avatar: 'https://files.mastodon.social/accounts/avatars/1093.jpg',
        header: 'https://files.mastodon.social/accounts/headers/1093.jpg',
        followers_count: 50000,
        following_count: 350,
        statuses_count: 12000,
        bot: false,
        created_at: '2016-03-16T00:00:00.000Z',
        fields: [{ name: 'Website', value: '<a href="https://mastodon.social">mastodon.social</a>' }],
      };

      const item = normalizeMastodonAccount(raw, 'https://mastodon.social');
      expect(item.id).toBe('mastodon:mastodon.social:1093');
      expect(item.platform).toBe('mastodon');
      expect(item.username).toBe('Gargron');
      expect(item.name).toBe('Eugen Rochko');
      expect(item.bio).toBe('Founder of "Mastodon"\nBuilding decentralized web.');
      expect(item.followersCount).toBe(50000);
      expect(item.followingCount).toBe(350);
      expect(item.metadata.instance).toBe('https://mastodon.social');
      expect(item.metadata.fields[0].value).toBe('mastodon.social');
    });
  });

  describe('profileItemToPostItem', () => {
    it('converts ProfileItem to PostItem for storage engine compatibility', () => {
      const raw = {
        id: '1093',
        username: 'Gargron',
        display_name: 'Eugen Rochko',
        note: '<p>Bio content</p>',
        followers_count: 100,
        following_count: 50,
      };
      const profile = normalizeMastodonAccount(raw, 'https://mastodon.social');
      const post = profileItemToPostItem(profile);

      expect(post.id).toBe('mastodon:mastodon.social:1093');
      expect(post.platform).toBe('mastodon');
      expect(post.category).toBe(CATEGORIES.SOCIAL);
      expect(post.authorName).toBe('Eugen Rochko');
      expect(post.content).toBe('Bio content');
      expect(post.likesCount).toBe(100);
      expect(post.repostsCount).toBe(50);
    });
  });

  describe('normalizeMastodonStatus', () => {
    it('maps status into PostItem with decoded content and CW support', () => {
      const raw = {
        id: '11223344',
        created_at: '2026-09-01T12:00:00.000Z',
        content: '<p>Exciting news &amp; updates!<br>Decentralized social web is growing.</p>',
        spoiler_text: 'Product announcement',
        sensitive: false,
        visibility: 'public',
        favourites_count: 42,
        reblogs_count: 18,
        replies_count: 7,
        media_attachments: [{ url: 'https://files.mastodon.social/media/1.png' }],
        tags: [{ name: 'fediverse' }, { name: 'mastodon' }],
        account: {
          id: '1093',
          username: 'Gargron',
          display_name: 'Eugen',
          avatar: 'https://files.mastodon.social/avatar.png',
        },
      };

      const item = normalizeMastodonStatus(raw, 'https://mastodon.social');
      expect(item.id).toBe('mastodon:mastodon.social:11223344');
      expect(item.platform).toBe('mastodon');
      expect(item.category).toBe(CATEGORIES.SOCIAL);
      expect(item.authorName).toBe('Eugen');
      expect(item.content).toBe('[CW: Product announcement] Exciting news & updates!\nDecentralized social web is growing.');
      expect(item.likesCount).toBe(42);
      expect(item.repostsCount).toBe(18);
      expect(item.repliesCount).toBe(7);
      expect(item.mediaUrls).toEqual(['https://files.mastodon.social/media/1.png']);
      expect(item.metadata.tags).toEqual(['fediverse', 'mastodon']);
    });
  });

  describe('normalizeMastodonTag', () => {
    it('maps trending hashtag into PostItem', () => {
      const raw = {
        name: 'tech',
        url: 'https://mastodon.social/tags/tech',
        history: [{ uses: '150', accounts: '80' }, { uses: '200', accounts: '120' }],
      };

      const item = normalizeMastodonTag(raw, 'https://mastodon.social', 1);
      expect(item.id).toBe('mastodon:mastodon.social:tag:tech');
      expect(item.category).toBe(CATEGORIES.SOCIAL);
      expect(item.content).toBe('#tech');
      expect(item.likesCount).toBe(350); // total uses
      expect(item.repostsCount).toBe(200); // total accounts
      expect(item.metadata.rank).toBe(1);
    });
  });
});
