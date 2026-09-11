// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt — Instagram normalizer unit tests (no mocks, real functions).
import { describe, it, expect } from 'vitest';
import {
  namespacedInstagramId,
  extractMediaId,
  normalizeInstagramMedia,
  normalizeInstagramProfile,
  normalizeInstagramComment,
  asRecord,
} from '../../../../src/scrapers/social/instagram/normalizer.js';

const RAW_MEDIA = {
  pk: 3123456789012345678,
  id: '3123456789012345678_98765',
  code: 'CabcXYZ123',
  media_type: 1,
  taken_at: 1700000000,
  caption: { text: 'Sunset over the bay 🌅' },
  like_count: 1523,
  comment_count: 87,
  view_count: 40210,
  user: { pk: 98765, username: 'natgeo', full_name: 'National Geographic', profile_pic_url: 'https://cdn/x.jpg' },
  image_versions2: { candidates: [{ url: 'https://cdn/1080.jpg' }, { url: 'https://cdn/640.jpg' }] },
  video_versions: [{ url: 'https://cdn/v.mp4' }],
  location: { name: 'Golden Gate' },
};

describe('namespacedInstagramId / extractMediaId', () => {
  it('prefixes the external id with instagram:', () => {
    expect(namespacedInstagramId(123)).toBe('instagram:123');
    expect(namespacedInstagramId('abc')).toBe('instagram:abc');
  });
  it('extractMediaId prefers pk over id', () => {
    expect(extractMediaId({ pk: 5, id: '5_9' })).toBe('5');
    expect(extractMediaId({ id: 'x_y' })).toBe('x_y');
  });
});

describe('normalizeInstagramMedia (AC-7)', () => {
  it('maps a raw media object into a PostItem', () => {
    const p = normalizeInstagramMedia(RAW_MEDIA);
    expect(p.id).toBe('instagram:3123456789012345678');
    expect(p.platform).toBe('instagram');
    expect(p.externalId).toBe('3123456789012345678');
    expect(p.category).toBe('social');
    expect(p.authorName).toBe('natgeo');
    expect(p.content).toContain('Sunset');
    expect(p.postUrl).toBe('https://www.instagram.com/p/CabcXYZ123/');
    expect(p.likesCount).toBe(1523);
    expect(p.repliesCount).toBe(87);
    expect(p.publishedAt).toEqual(new Date(1700000000 * 1000));
    expect(p.crawledAt).toBeInstanceOf(Date);
  });
  it('collects image + video urls into mediaUrls', () => {
    const p = normalizeInstagramMedia(RAW_MEDIA);
    expect(p.mediaUrls).toContain('https://cdn/1080.jpg');
    expect(p.mediaUrls).toContain('https://cdn/v.mp4');
  });
  it('handles caption as a plain string and as missing', () => {
    expect(normalizeInstagramMedia({ ...RAW_MEDIA, caption: 'plain' }).content).toBe('plain');
    expect(normalizeInstagramMedia({ ...RAW_MEDIA, caption: undefined }).content).toBe('');
  });
  it('marks video media_type=2 as isVideo', () => {
    const p = normalizeInstagramMedia({ ...RAW_MEDIA, media_type: 2 });
    expect(p.metadata.isVideo).toBe(true);
  });
});

describe('normalizeInstagramProfile', () => {
  it('maps a user object into a ProfileItem', () => {
    const u = normalizeInstagramProfile({
      pk: 98765, username: 'natgeo', full_name: 'National Geographic',
      biography: 'Photos of the planet', follower_count: 250000000, following_count: 130,
      is_verified: true, is_private: false, profile_pic_url_hd: 'https://cdn/hd.jpg', media_count: 30000,
    });
    expect(u.id).toBe('instagram:98765');
    expect(u.platform).toBe('instagram');
    expect(u.username).toBe('natgeo');
    expect(u.bio).toContain('planet');
    expect(u.followersCount).toBe(250000000);
    expect(u.followingCount).toBe(130);
    expect(u.metadata.isVerified).toBe(true);
    expect(u.metadata.mediaCount).toBe(30000);
    expect(u.profileUrl).toBe('https://www.instagram.com/natgeo/');
  });
  it('reads follower counts from GraphQL edge_* shape', () => {
    const u = normalizeInstagramProfile({
      pk: 1, username: 'x', edge_followed_by: { count: 42 }, edge_follow: { count: 7 },
    });
    expect(u.followersCount).toBe(42);
    expect(u.followingCount).toBe(7);
  });
});

describe('normalizeInstagramComment', () => {
  it('maps a comment into a CommentItem with namespaced post id', () => {
    const c = normalizeInstagramComment(
      { pk: 555, text: 'Amazing shot!', user: { pk: 1, username: 'fan' }, like_count: 3, created_at: 1700000100 },
      '3123456789012345678',
    );
    expect(c.id).toBe('instagram:3123456789012345678:555');
    expect(c.platform).toBe('instagram');
    expect(c.postId).toBe('3123456789012345678');
    expect(c.authorName).toBe('fan');
    expect(c.content).toBe('Amazing shot!');
    expect(c.likesCount).toBe(3);
  });
});

describe('asRecord', () => {
  it('returns {} for non-objects and the value for objects', () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord('x')).toEqual({});
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });
});
