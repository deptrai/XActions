// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — A2A Jev Semantic Router Tests (Story 44.1)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeTaskIntent } from '../../src/a2a/jevRouter.js';
import { resolveSkillSemantically } from '../../src/a2a/skillRegistry.js';
import { createBridge } from '../../src/a2a/bridge.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(choice, confidence = 0.95) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      answers: {
        selectedSkill: {
          type: 'choice',
          choice,
          confidence,
        },
      },
      usage: { input_tokens: 150, output_tokens: 20 },
    }),
    text: async () => JSON.stringify({ choice, confidence }),
  };
}

describe('A2A Jev Router (Story 44.1)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.TYPESAFE_API_KEY = 'test-jev-key';
  });

  describe('routeTaskIntent', () => {
    it('returns null for empty or invalid query', async () => {
      const res = await routeTaskIntent('');
      expect(res.skillId).toBeNull();
      expect(res.disambiguationNeeded).toBe(false);

      const resNull = await routeTaskIntent(null);
      expect(resNull.skillId).toBeNull();
    });

    it('returns direct match when only 1 candidate matches', async () => {
      const candidates = [
        { id: 'xactions.x_get_profile', name: 'Profile Lookup', description: 'Fetch profile' },
      ];
      const res = await routeTaskIntent('profile query', { candidateSkills: candidates });
      expect(res.skillId).toBe('xactions.x_get_profile');
      expect(res.source).toBe('direct');
      expect(res.confidence).toBe(1.0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('disambiguates between multiple skills using Jev Choice with high confidence', async () => {
      const candidates = [
        { id: 'xactions.x_get_profile', name: 'Get Profile', description: 'Fetch user profile' },
        { id: 'xactions.x_get_tweets', name: 'Get Tweets', description: 'Fetch recent tweets from account' },
        { id: 'xactions.x_search_tweets', name: 'Search Tweets', description: 'Search global tweets' },
      ];

      mockFetch.mockResolvedValueOnce(mockJevSuccess('x_get_tweets', 0.92));

      const brain = new JevBrain({ apiKey: 'test-key' });
      const res = await routeTaskIntent('I want to see what someone posted yesterday', {
        candidateSkills: candidates,
        brain,
      });

      expect(res.skillId).toBe('xactions.x_get_tweets');
      expect(res.confidence).toBe(0.92);
      expect(res.disambiguationNeeded).toBe(false);
      expect(res.source).toBe('jev');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('flags disambiguationNeeded when confidence is below threshold', async () => {
      const candidates = [
        { id: 'xactions.x_get_profile', name: 'Get Profile', description: 'Fetch user profile' },
        { id: 'xactions.x_get_tweets', name: 'Get Tweets', description: 'Fetch recent tweets from account' },
      ];

      mockFetch.mockResolvedValueOnce(mockJevSuccess('x_get_tweets', 0.55)); // below 0.70 threshold

      const brain = new JevBrain({ apiKey: 'test-key' });
      const res = await routeTaskIntent('something about a user', {
        candidateSkills: candidates,
        brain,
        confidenceThreshold: 0.70,
      });

      expect(res.skillId).toBeNull();
      expect(res.disambiguationNeeded).toBe(true);
      expect(res.confidence).toBe(0.55);
    });

    it('flags disambiguationNeeded when Jev returns "unclear"', async () => {
      const candidates = [
        { id: 'xactions.x_get_profile', name: 'Get Profile', description: 'Fetch user profile' },
        { id: 'xactions.x_get_tweets', name: 'Get Tweets', description: 'Fetch recent tweets from account' },
      ];

      mockFetch.mockResolvedValueOnce(mockJevSuccess('unclear', 0.85));

      const brain = new JevBrain({ apiKey: 'test-key' });
      const res = await routeTaskIntent('general vague question', {
        candidateSkills: candidates,
        brain,
      });

      expect(res.skillId).toBeNull();
      expect(res.disambiguationNeeded).toBe(true);
    });

    it('gracefully degrades when Jev plane is degraded (no key / error)', async () => {
      const candidates = [
        { id: 'xactions.x_get_profile', name: 'Get Profile', description: 'Fetch user profile' },
        { id: 'xactions.x_get_tweets', name: 'Get Tweets', description: 'Fetch recent tweets' },
      ];

      const prevKey = process.env.TYPESAFE_API_KEY;
      delete process.env.TYPESAFE_API_KEY;

      const degradedBrain = new JevBrain({ apiKey: '' });
      const res = await routeTaskIntent('check user', {
        candidateSkills: candidates,
        brain: degradedBrain,
      });

      process.env.TYPESAFE_API_KEY = prevKey;

      expect(res.degraded).toBe(true);
      expect(res.source).toBe('fallback');
      expect(res.skillId).toBe('xactions.x_get_profile'); // falls back to first candidate
    });
  });

  describe('resolveSkillSemantically in skillRegistry', () => {
    it('resolves skill via semantic router', async () => {
      mockFetch.mockResolvedValueOnce(mockJevSuccess('x_get_profile', 0.9));

      const brain = new JevBrain({ apiKey: 'test-key' });
      const res = await resolveSkillSemantically('inspect user account details', { brain });

      expect(res.skill).not.toBeNull();
      expect(res.confidence).toBe(0.9);
      expect(res.disambiguationNeeded).toBe(false);
    });
  });

  describe('parseNaturalLanguageAsync in bridge', () => {
    it('uses fast-path regex when pattern matches exactly', async () => {
      const bridge = createBridge();
      const res = await bridge.parseNaturalLanguageAsync('get profile for @nasa');

      expect(res).not.toBeNull();
      expect(res.tool).toBe('x_get_profile');
      expect(res.params.username).toBe('nasa');
      expect(mockFetch).not.toHaveBeenCalled(); // 0ms fast-path
    });

    it('falls back to semantic Jev routing when regex does not match', async () => {
      mockFetch.mockResolvedValueOnce(mockJevSuccess('x_get_profile', 0.88));

      const brain = new JevBrain({ apiKey: 'test-key' });
      const bridge = createBridge();
      const res = await bridge.parseNaturalLanguageAsync(
        'can you give me comprehensive bio and metrics of this account',
        { brain }
      );

      expect(res).not.toBeNull();
      expect(res.tool).toBe('x_get_profile');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
