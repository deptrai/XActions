// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — ThoughtLeaderAgent Jev Adoption Tests (Story 42.2)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThoughtLeaderAgent } from '../../src/agents/thoughtLeaderAgent.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const MINIMAL_CONFIG = {
  niche: { name: 'AI', searchTerms: ['AI agents'], influencers: ['@testuser'], keywords: ['LLM', 'AI'] },
  persona: { name: 'TestBot', handle: '@testbot', tone: 'friendly', expertise: ['AI'], opinions: ['Open source wins'], avoid: ['spam'] },
  llm: { provider: 'openrouter', apiKey: 'test-key', models: { fast: 'test/fast', mid: 'test/mid', smart: 'test/smart' } },
  schedule: { timezone: 'UTC', sleepHours: [23, 6] },
  limits: { dailyLikes: 100, dailyFollows: 50, dailyComments: 50, dailyPosts: 5 },
  browser: { headless: true, sessionPath: '/tmp/test-session-jev.json' },
  dbPath: '/tmp/test-tl-agent-jev.db',
};

const SHARED_SPAM_INSTRUCTION =
  'This post is spam, bait, scam, or airdrop-farming — not mere self-promotion';

function makeJevAnswer(actionChoice, actionConf, isSpamNoul, replyWorthyNoul = 0.8) {
  return {
    answers: {
      action: { type: 'choice', choice: actionChoice, confidence: actionConf },
      isSpam: { type: 'noul', noul: isSpamNoul },
      replyWorthy: { type: 'noul', noul: replyWorthyNoul },
    },
    usage: { input_tokens: 10, output_tokens: 5 },
    meta: { degraded: false, source: 'jev' },
  };
}

describe('ThoughtLeaderAgent Jev adoption (Story 42.2)', () => {
  let agent;

  beforeEach(() => {
    agent = new ThoughtLeaderAgent(MINIMAL_CONFIG);
    // Mock heavy dependencies — keep JevBrain real, stub its decide per-test
    agent.jev = new JevBrain({ apiKey: 'test-jev-key', confidenceThresholds: { like: 0.6, reply: 0.85, safeToSend: 0.8 } });
    agent.llm = {
      scoreRelevance: vi.fn().mockResolvedValue(70),
      generateReply: vi.fn().mockResolvedValue('great insight on this'),
      checkPersonaConsistency: vi.fn().mockResolvedValue({ consistent: true }),
      generateContent: vi.fn().mockResolvedValue({ type: 'tweet', text: 'draft post content' }),
    };
    agent.browser = {
      searchFor: vi.fn(),
      extractTweets: vi.fn().mockResolvedValue([{ id: 't1', text: 'relevant AI tweet', author: 'author1', isAd: false }]),
      likeTweet: vi.fn().mockResolvedValue(true),
      replyToTweet: vi.fn().mockResolvedValue(true),
      bookmarkTweet: vi.fn().mockResolvedValue(true),
      scrollDown: vi.fn(),
      navigate: vi.fn(),
      antiDetection: { simulateReading: vi.fn() },
      postTweet: vi.fn().mockResolvedValue(true),
      postThread: vi.fn(),
      getTrendingTopics: vi.fn().mockResolvedValue([]),
    };
    agent.db = {
      isDuplicate: vi.fn().mockReturnValue(false),
      logAction: vi.fn(),
      recordContent: vi.fn(),
      getRecentPosts: vi.fn().mockReturnValue([]),
    };
    agent.persona = {
      name: 'TestBot',
      handle: 'testbot',
      toJSON: vi.fn().mockReturnValue({ name: 'TestBot' }),
      validateContent: vi.fn().mockReturnValue({ valid: true }),
      addExample: vi.fn(),
    };
    agent.calendar = { getQueue: vi.fn().mockReturnValue([]) };
    agent.running = true;
    agent._canDo = vi.fn().mockReturnValue(true);
  });

  describe('_searchAndEngage — Jev typed decision path', () => {
    it('likes AND replies when Jev returns reply with high confidence', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue(makeJevAnswer('reply', 0.92, 0.05));
      await agent._searchAndEngage('ai');
      expect(agent.browser.likeTweet).toHaveBeenCalledTimes(1);
      expect(agent.llm.generateReply).toHaveBeenCalledTimes(1);
      expect(agent.browser.replyToTweet).toHaveBeenCalledTimes(1);
      expect(agent.db.logAction).toHaveBeenCalledWith('comment', 't1', expect.objectContaining({ choice: 'reply' }));
    });

    it('skips entirely when Jev flags spam (noul >= 0.6)', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue(makeJevAnswer('reply', 0.95, 0.8));
      await agent._searchAndEngage('ai');
      expect(agent.browser.likeTweet).not.toHaveBeenCalled();
      expect(agent.browser.replyToTweet).not.toHaveBeenCalled();
    });

    it('skips entirely when Jev says ignore with high confidence', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue(makeJevAnswer('ignore', 0.9, 0.1));
      await agent._searchAndEngage('ai');
      expect(agent.browser.likeTweet).not.toHaveBeenCalled();
      expect(agent.browser.replyToTweet).not.toHaveBeenCalled();
    });

    it('likes only when reply confidence is below reply threshold (review zone)', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue(makeJevAnswer('reply', 0.70, 0.1, 0.8));
      await agent._searchAndEngage('ai');
      // like gate (0.6): 0.70 >= 0.6 → act → like happens
      expect(agent.browser.likeTweet).toHaveBeenCalledTimes(1);
      // reply gate (0.85): 0.70 < 0.85 → review → no reply
      expect(agent.browser.replyToTweet).not.toHaveBeenCalled();
    });

    it('sends the shared isSpam literal to Jev (parity contract)', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue(makeJevAnswer('ignore', 0.9, 0.1));
      await agent._searchAndEngage('ai');
      const questions = agent.jev.decide.mock.calls[0][1];
      expect(questions.isSpam.instructions).toBe(SHARED_SPAM_INSTRUCTION);
    });

    it('falls back to legacy score heuristic when Jev degraded', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue({
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
        meta: { degraded: true, reason: 'missing-key', source: 'llmbrain' },
      });
      await agent._searchAndEngage('ai');
      expect(agent.llm.scoreRelevance).toHaveBeenCalledWith('relevant AI tweet', ['LLM', 'AI']);
      // score 70 > 60 → like happens via legacy path
      expect(agent.browser.likeTweet).toHaveBeenCalledTimes(1);
      // score 70 < 80 → no comment
      expect(agent.browser.replyToTweet).not.toHaveBeenCalled();
    });
  });

  describe('_browseHomeFeed — Jev typed decision path', () => {
    it('likes and bookmarks per Jev verdicts', async () => {
      agent.browser.extractTweets.mockResolvedValue([{ id: 't1', text: 'feed tweet', author: 'a1', isAd: false }]);
      agent.jev.decide = vi.fn()
        .mockResolvedValue(makeJevAnswer('like', 0.9, 0.05));
      await agent._browseHomeFeed();
      expect(agent.browser.likeTweet).toHaveBeenCalled();
      // bookmark path not chosen when choice is 'like'
      expect(agent.browser.bookmarkTweet).not.toHaveBeenCalled();
    });

    it('bookmarks when Jev returns bookmark verdict', async () => {
      agent.browser.extractTweets.mockResolvedValue([{ id: 't1', text: 'feed tweet', author: 'a1', isAd: false }]);
      agent.jev.decide = vi.fn()
        .mockResolvedValue(makeJevAnswer('bookmark', 0.92, 0.05));
      await agent._browseHomeFeed();
      expect(agent.browser.likeTweet).toHaveBeenCalled(); // like/bookmark both allow like
      expect(agent.browser.bookmarkTweet).toHaveBeenCalled();
    });

    it('sends the shared isSpam literal to Jev (parity contract)', async () => {
      agent.browser.extractTweets.mockResolvedValue([{ id: 't1', text: 'feed tweet', author: 'a1', isAd: false }]);
      agent.jev.decide = vi.fn().mockResolvedValue(makeJevAnswer('ignore', 0.9, 0.1));
      await agent._browseHomeFeed();
      const questions = agent.jev.decide.mock.calls[0][1];
      expect(questions.isSpam.instructions).toBe(SHARED_SPAM_INSTRUCTION);
    });

    it('degraded mode falls back to legacy score heuristics', async () => {
      agent.browser.extractTweets.mockResolvedValue([{ id: 't1', text: 'feed tweet', author: 'a1', isAd: false }]);
      agent.jev.decide = vi.fn().mockResolvedValue({
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
        meta: { degraded: true, reason: 'budget', source: 'llmbrain' },
      });
      await agent._browseHomeFeed();
      expect(agent.llm.scoreRelevance).toHaveBeenCalled();
    });
  });

  describe('_createContent — Jev safety gate', () => {
    it('blocks post when safeToSend noul below threshold', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue({
        answers: { safeToSend: { type: 'noul', noul: 0.3 } },
        usage: { input_tokens: 10, output_tokens: 5 },
        meta: { degraded: false, source: 'jev' },
      });
      await agent._createContent();
      expect(agent.browser.postTweet).not.toHaveBeenCalled();
      expect(agent.db.recordContent).not.toHaveBeenCalled();
    });

    it('posts when safeToSend noul above threshold', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue({
        answers: { safeToSend: { type: 'noul', noul: 0.95 } },
        usage: { input_tokens: 10, output_tokens: 5 },
        meta: { degraded: false, source: 'jev' },
      });
      await agent._createContent();
      expect(agent.browser.postTweet).toHaveBeenCalledWith('draft post content');
      expect(agent.db.recordContent).toHaveBeenCalled();
    });

    it('skips safety check but posts when Jev degraded (persona check already passed)', async () => {
      agent.jev.decide = vi.fn().mockResolvedValue({
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
        meta: { degraded: true, reason: 'timeout', source: 'llmbrain' },
      });
      await agent._createContent();
      expect(agent.browser.postTweet).toHaveBeenCalledWith('draft post content');
    });
  });

  describe('_createContent — Jev trend safety + opportunity filter (Story 42.6)', () => {
    it('filters unsafe trends before generateContent', async () => {
      agent.browser.getTrendingTopics.mockResolvedValue(['Earthquake kills hundreds', 'AI agents breakthrough']);
      // First decide() = trend analysis for 'Earthquake...' (called by analyzeTrends inside _createContent)
      // Second decide() = trend analysis for 'AI agents breakthrough'
      // Third decide() = safety Noul for safeToSend
      agent.jev.decide = vi.fn()
        .mockResolvedValueOnce({
          answers: {
            vertical: { type: 'choice', choice: 'other', confidence: 0.8 },
            brandSafe: { type: 'noul', noul: 0.9 },
            opportunity: { type: 'score', score: 0, confidence: 0.9 },
          },
          usage: { input_tokens: 50, output_tokens: 20 },
          meta: { degraded: false, source: 'jev' },
        })
        .mockResolvedValueOnce({
          answers: {
            vertical: { type: 'choice', choice: 'tech_ai', confidence: 0.9 },
            brandSafe: { type: 'noul', noul: 0.05 },
            opportunity: { type: 'score', score: 3, confidence: 0.85 },
          },
          usage: { input_tokens: 50, output_tokens: 20 },
          meta: { degraded: false, source: 'jev' },
        })
        .mockResolvedValueOnce({
          answers: { safeToSend: { type: 'noul', noul: 0.95 } },
          usage: { input_tokens: 10, output_tokens: 5 },
          meta: { degraded: false, source: 'jev' },
        });
      await agent._createContent();
      // generateContent should only get the safe+hook trend
      expect(agent.llm.generateContent).toHaveBeenCalledWith(expect.objectContaining({
        trends: ['AI agents breakthrough'],
      }));
      expect(agent.browser.postTweet).toHaveBeenCalled();
    });

    it('keeps raw trends when Jev trend analysis is fully degraded', async () => {
      agent.browser.getTrendingTopics.mockResolvedValue(['Topic A', 'Topic B']);
      agent.jev.decide = vi.fn()
        // Both trend analyses degrade
        .mockResolvedValue({
          answers: {},
          usage: { input_tokens: 0, output_tokens: 0 },
          meta: { degraded: true, reason: 'missing-key', source: 'llmbrain' },
        });
      await agent._createContent();
      // Degraded → keep original trends
      expect(agent.llm.generateContent).toHaveBeenCalledWith(expect.objectContaining({
        trends: ['Topic A', 'Topic B'],
      }));
    });

    it('skips trend filter when no trends returned', async () => {
      agent.browser.getTrendingTopics.mockResolvedValue([]);
      agent.jev.decide = vi.fn().mockResolvedValue({
        answers: { safeToSend: { type: 'noul', noul: 0.95 } },
        usage: { input_tokens: 10, output_tokens: 5 },
        meta: { degraded: false, source: 'jev' },
      });
      await agent._createContent();
      expect(agent.llm.generateContent).toHaveBeenCalledWith(expect.objectContaining({
        trends: [],
      }));
    });
  });
});
