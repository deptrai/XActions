// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Unit tests for the canonical Twitter/X hybrid GraphQL/REST schema module.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  GRAPHQL,
  REST,
  DEFAULT_FEATURES,
  DEFAULT_FIELD_TOGGLES,
  USER_FEATURES,
  RATE_LIMITS,
  BEARER_TOKEN,
  GRAPHQL_BASE,
  REST_BASE,
  API_BASE,
  buildGraphQLUrl,
  buildGraphQLVariables,
  validateEndpoints,
  TWITTER_GRAPHQL_QUERY_IDS,
} from '../../../../src/scrapers/social/twitter/schema.js';

describe('Twitter hybrid schema', () => {
  it('exports all expected GraphQL endpoint keys', () => {
    const keys = Object.keys(GRAPHQL);
    const expected = [
      'UserByScreenName',
      'UserByRestId',
      'UserTweets',
      'UserTweetsAndReplies',
      'UserMedia',
      'UserLikes',
      'TweetDetail',
      'TweetResultByRestId',
      'SearchTimeline',
      'Followers',
      'Following',
      'Likes',
      'Retweeters',
      'ListMembers',
      'ListTimeline',
      'BookmarkTimeline',
      'HomeTimeline',
      'HomeLatestTimeline',
      'CreateTweet',
      'CreateScheduledTweet',
      'DeleteTweet',
      'FavoriteTweet',
      'UnfavoriteTweet',
      'CreateRetweet',
      'DeleteRetweet',
      'CreateBookmark',
      'DeleteBookmark',
    ];
    for (const key of expected) {
      expect(keys).toContain(key);
      expect(GRAPHQL[key]).toHaveProperty('queryId');
      expect(GRAPHQL[key]).toHaveProperty('operationName');
      expect(typeof GRAPHQL[key].queryId).toBe('string');
      expect(typeof GRAPHQL[key].operationName).toBe('string');
    }
    expect(keys.length).toBe(expected.length);
  });

  it('exports all expected REST endpoint keys', () => {
    const keys = Object.keys(REST);
    const expected = [
      'friendshipsCreate',
      'friendshipsDestroy',
      'blocksCreate',
      'blocksDestroy',
      'mutesCreate',
      'mutesDestroy',
      'pinTweet',
      'unpinTweet',
      'guestActivate',
      'verifyCredentials',
      'dmNew',
      'dmDestroy',
      'dmInbox',
      'dmConversation',
      'dmMarkRead',
      'notificationsAll',
      'notificationsVerified',
      'notificationsMentions',
      'guide',
      'trendsAvailable',
      'trendsPlace',
      'listsCreate',
      'listsMembersCreateAll',
      'listsMembersDestroyAll',
    ];
    for (const key of expected) {
      expect(keys).toContain(key);
      expect(typeof REST[key]).toBe('string');
      expect(REST[key]).toMatch(/^\/(1\.1|2)\//);
    }
    expect(keys.length).toBe(expected.length);
  });

  it('exports feature/field-toggle/rate-limit objects and constants', () => {
    expect(typeof DEFAULT_FEATURES).toBe('object');
    expect(Object.keys(DEFAULT_FEATURES).length).toBeGreaterThan(0);
    expect(typeof DEFAULT_FIELD_TOGGLES).toBe('object');
    expect(typeof USER_FEATURES).toBe('object');
    expect(typeof RATE_LIMITS).toBe('object');
    expect(typeof BEARER_TOKEN).toBe('string');
    expect(BEARER_TOKEN.length).toBeGreaterThan(0);
    expect(GRAPHQL_BASE).toBe('https://x.com/i/api/graphql');
    expect(REST_BASE).toBe('https://x.com/i/api');
    expect(API_BASE).toBe('https://api.x.com');
  });

  it('buildGraphQLVariables returns correct shape for UserByScreenName', () => {
    const v = buildGraphQLVariables('UserByScreenName', { username: 'nasa' });
    expect(v).toEqual({
      screen_name: 'nasa',
      withSafetyModeUserFields: false,
    });
  });

  it('buildGraphQLVariables returns correct shape for UserTweets', () => {
    const v = buildGraphQLVariables('UserTweets', { userId: '12345', count: 40, cursor: 'abc' });
    expect(v.userId).toBe('12345');
    expect(v.count).toBe(40);
    expect(v.cursor).toBe('abc');
    expect(v.includePromotedContent).toBe(true);
    expect(v.withV2Timeline).toBe(true);
  });

  it('buildGraphQLVariables returns correct shape for SearchTimeline', () => {
    const v = buildGraphQLVariables('SearchTimeline', { query: 'xactions', count: 20, product: 'Latest' });
    expect(v.rawQuery).toBe('xactions');
    expect(v.count).toBe(20);
    expect(v.querySource).toBe('typed_query');
    expect(v.product).toBe('Latest');
  });

  it('buildGraphQLVariables returns correct shape for CreateTweet', () => {
    const v = buildGraphQLVariables('CreateTweet', { text: 'hello world', mediaEntities: [{ id: '1' }] });
    expect(v.tweet_text).toBe('hello world');
    expect(v.dark_request).toBe(false);
    expect(v.media).toEqual({
      media_entities: [{ id: '1' }],
      possibly_sensitive: false,
    });
    expect(v.semantic_annotation_ids).toEqual([]);
  });

  it('buildGraphQLUrl encodes variables, features and fieldToggles', () => {
    const url = buildGraphQLUrl('abc', 'OpName', { x: 1 }, { f1: true }, { ft1: false });
    expect(url).toMatch(/^https:\/\/x\.com\/i\/api\/graphql\/abc\/OpName\?/);
    expect(url).toContain('variables=%7B%22x%22%3A1%7D');
    expect(url).toContain('features=%7B%22f1%22%3Atrue%7D');
    expect(url).toContain('fieldToggles=%7B%22ft1%22%3Afalse%7D');
  });

  it('TWITTER_GRAPHQL_QUERY_IDS maps to GRAPHQL entries', () => {
    expect(TWITTER_GRAPHQL_QUERY_IDS.TweetDetail).toBe(GRAPHQL.TweetDetail.queryId);
    expect(TWITTER_GRAPHQL_QUERY_IDS.UserByScreenName).toBe(GRAPHQL.UserByScreenName.queryId);
    expect(TWITTER_GRAPHQL_QUERY_IDS.Followers).toBe(GRAPHQL.Followers.queryId);
    expect(TWITTER_GRAPHQL_QUERY_IDS.SearchTimeline).toBe(GRAPHQL.SearchTimeline.queryId);
  });

  it('validateEndpoints is exported as an async function', () => {
    expect(typeof validateEndpoints).toBe('function');
  });
});
