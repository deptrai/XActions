// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi } from 'vitest';
import { Scraper, SearchMode } from '../../src/client/index.js';
import * as scrapers from '../../src/scrapers/index.js';

describe('Scraper Backward-Compatibility Stub (Story 26.2)', () => {
  it('instantiates with options', () => {
    const scraper = new Scraper({ apiKey: 'test' });
    expect(scraper.options).toEqual({ apiKey: 'test' });
    expect(scraper.cookies).toEqual({});
  });

  it('sets and gets cookies', async () => {
    const scraper = new Scraper();
    await scraper.setCookies('auth_token=abc; ct0=xyz');
    const cookies = await scraper.getCookies();
    expect(cookies.auth_token).toBe('abc');
    expect(cookies.ct0).toBe('xyz');
    expect(await scraper.isLoggedIn()).toBe(true);
  });

  it('exports SearchMode enum', () => {
    expect(SearchMode.Top).toBe('Top');
    expect(SearchMode.Latest).toBe('Latest');
    expect(SearchMode.Photos).toBe('Photos');
    expect(SearchMode.Videos).toBe('Videos');
  });

  it('getProfile unwraps profile envelope', async () => {
    const spy = vi.spyOn(scrapers, 'scrape').mockResolvedValueOnce({
      profile: { id: '123', name: 'Test User', username: 'testuser' },
    });
    const scraper = new Scraper();
    const profile = await scraper.getProfile('testuser');
    expect(profile.name).toBe('Test User');
    expect(spy).toHaveBeenCalledWith('twitter', 'profile', expect.objectContaining({ username: 'testuser' }));
    spy.mockRestore();
  });

  it('getTweet calls thread action and unwraps rootTweet', async () => {
    const spy = vi.spyOn(scrapers, 'scrape').mockResolvedValueOnce({
      rootTweet: { id: '456', text: 'Hello world' },
      posts: [{ id: '456', text: 'Hello world' }],
    });
    const scraper = new Scraper();
    const tweet = await scraper.getTweet('456');
    expect(tweet.text).toBe('Hello world');
    expect(spy).toHaveBeenCalledWith('twitter', 'thread', expect.objectContaining({ tweetId: '456' }));
    spy.mockRestore();
  });

  it('getTweets yields posts from search', async () => {
    const spy = vi.spyOn(scrapers, 'scrape').mockResolvedValueOnce({
      posts: [{ id: '1', text: 't1' }, { id: '2', text: 't2' }],
    });
    const scraper = new Scraper();
    const tweets = [];
    for await (const t of scraper.getTweets('user', 10)) {
      tweets.push(t);
    }
    expect(tweets).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith('twitter', 'search', expect.objectContaining({ query: 'from:user', limit: 10 }));
    spy.mockRestore();
  });

  it('getFollowers unrolls generator from followers array', async () => {
    const spy = vi.spyOn(scrapers, 'scrape').mockResolvedValueOnce({
      followers: [{ id: 'f1', name: 'Follower 1' }],
    });
    const scraper = new Scraper();
    const followers = [];
    for await (const f of scraper.getFollowers('user', 5)) {
      followers.push(f);
    }
    expect(followers).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith('twitter', 'followers', expect.objectContaining({ username: 'user', limit: 5 }));
    spy.mockRestore();
  });

  it('has all legacy engagement methods as stubs', () => {
    const scraper = new Scraper();
    expect(typeof scraper.likeTweet).toBe('function');
    expect(typeof scraper.unlikeTweet).toBe('function');
    expect(typeof scraper.retweet).toBe('function');
    expect(typeof scraper.unretweet).toBe('function');
    expect(typeof scraper.followUser).toBe('function');
    expect(typeof scraper.unfollowUser).toBe('function');
    expect(typeof scraper.sendQuoteTweet).toBe('function');
    expect(typeof scraper.deleteTweet).toBe('function');
    expect(typeof scraper.getTrends).toBe('function');
  });
});
