// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * EPS-4 — AI Tweet Writer tests
 *
 * No mocks, stubs, or fakes. Two tiers:
 *   1. Always-on: input validation, provider resolution, MCP tool schema,
 *      Express router wiring. These exercise real code paths with no API key.
 *   2. Gated by env key (OPENROUTER_API_KEY / OPENAI_API_KEY / XAI_API_KEY):
 *      real LLM calls against the live provider. Skipped when no key is set,
 *      mirroring the tests/x402-integration.test.js server-gating pattern.
 *
 * @author nichxbt
 */

import { describe, it, expect } from 'vitest';
import {
  generateTweet,
  generateThread,
  generateThreadFromText,
  generateBio,
  rewriteTweet,
  generateReply,
} from '../../src/ai/tweetGenerator.js';
import { analyzeVoice } from '../../src/ai/voiceAnalyzer.js';
import { TOOLS } from '../../src/mcp/server.js';
import writerRouter from '../../api/routes/ai/writer.js';

// ----------------------------------------------------------------------------
// Fixtures — real-shaped voice profile built via the real analyzeVoice()
// on synthetic tweets. This is test input data, not a mock/stub/fake of a
// dependency; it exercises the same code path production uses.
// ----------------------------------------------------------------------------

const sampleTweets = Array.from({ length: 30 }, (_, i) => ({
  text: `shipping fast beats perfection — build ${i} things and ship them today`,
  likes: 100 - i,
  retweets: 20 - (i % 5),
  replies: 5,
  createdAt: new Date(2026, 0, i + 1).toISOString(),
}));

const voiceProfile = analyzeVoice('nirholas', sampleTweets, { minTweets: 1 });

const hasLLMKey = !!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.GROK_API_KEY);
const describeWithKey = hasLLMKey ? describe : describe.skip;

// ----------------------------------------------------------------------------
// Tier 1 — Always-on: input validation & provider resolution (no API key)
// ----------------------------------------------------------------------------

describe('EPS-4 AI Tweet Writer — input validation', () => {
  describe('generateTweet', () => {
    it('throws when topic is missing', async () => {
      await expect(generateTweet(voiceProfile, { count: 3 })).rejects.toThrow(/topic is required/);
    });

    it('throws when voiceProfile is missing', async () => {
      await expect(generateTweet(null, { topic: 'shipping fast' })).rejects.toThrow(/voiceProfile is required/);
    });

    it('throws a provider/API-key error when no LLM key is configured', async () => {
      // Real code path: resolveProvider falls back to openrouter, callLLM
      // throws because no key is present. Not a mock — verifies the real
      // error surface users hit when they forget to set an env key.
      const origOR = process.env.OPENROUTER_API_KEY;
      const origOA = process.env.OPENAI_API_KEY;
      const origXA = process.env.XAI_API_KEY;
      const origGR = process.env.GROK_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.XAI_API_KEY;
      delete process.env.GROK_API_KEY;
      try {
        await expect(
          generateTweet(voiceProfile, { topic: 'shipping fast', apiKey: undefined, openaiApiKey: undefined, grokApiKey: undefined })
        ).rejects.toThrow(/API key required/i);
      } finally {
        if (origOR) process.env.OPENROUTER_API_KEY = origOR;
        if (origOA) process.env.OPENAI_API_KEY = origOA;
        if (origXA) process.env.XAI_API_KEY = origXA;
        if (origGR) process.env.GROK_API_KEY = origGR;
      }
    });
  });

  describe('generateThread', () => {
    it('throws when topic is missing', async () => {
      await expect(generateThread(voiceProfile, { length: 5 })).rejects.toThrow(/topic is required/);
    });
  });

  describe('generateThreadFromText (Epic 4 — thread from long text)', () => {
    it('throws when text is missing', async () => {
      await expect(generateThreadFromText(voiceProfile, {})).rejects.toThrow(/text is required/);
    });

    it('throws when voiceProfile is missing', async () => {
      await expect(generateThreadFromText(null, { text: 'some long text' })).rejects.toThrow(/voiceProfile is required/);
    });
  });

  describe('generateBio (Epic 4 — bio generator)', () => {
    it('throws when neither topic nor voiceProfile is provided', async () => {
      await expect(generateBio(null, {})).rejects.toThrow(/topic or voiceProfile is required/);
    });

    it('accepts a topic without a voice profile (does not throw on validation)', async () => {
      // Should get past validation; will then throw on missing API key (real path).
      await expect(generateBio(null, { topic: 'indie hacker' })).rejects.toThrow(/API key required/i);
    });
  });

  describe('rewriteTweet', () => {
    it('throws when originalText is missing', async () => {
      await expect(rewriteTweet(voiceProfile, '', { count: 3 })).rejects.toThrow(/originalText is required/);
    });
  });

  describe('generateReply', () => {
    it('throws when originalTweet is missing', async () => {
      await expect(generateReply(voiceProfile, '', { count: 3 })).rejects.toThrow(/originalTweet is required/);
    });
  });
});

// ----------------------------------------------------------------------------
// Tier 1 — Always-on: MCP tool registration & schema
// ----------------------------------------------------------------------------

describe('EPS-4 AI Tweet Writer — MCP x_ai_write tool', () => {
  it('registers the x_ai_write tool', () => {
    const tool = TOOLS.find((t) => t.name === 'x_ai_write');
    expect(tool).toBeDefined();
    expect(tool.description).toMatch(/AI Tweet Writer/i);
  });

  it('requires topic and exposes the Epic 4 type enum', () => {
    const tool = TOOLS.find((t) => t.name === 'x_ai_write');
    expect(tool.inputSchema.required).toContain('topic');
    const typeProp = tool.inputSchema.properties.type;
    expect(typeProp.enum).toEqual(expect.arrayContaining(['tweet', 'thread', 'thread-from-text', 'bio']));
  });

  it('exposes the tone selector enum (funny, professional, controversial)', () => {
    const tool = TOOLS.find((t) => t.name === 'x_ai_write');
    const toneProp = tool.inputSchema.properties.tone;
    expect(toneProp.enum).toEqual(expect.arrayContaining(['funny', 'professional', 'controversial']));
  });
});

// ----------------------------------------------------------------------------
// Tier 1 — Always-on: Express writer router wiring
// ----------------------------------------------------------------------------

describe('EPS-4 AI Tweet Writer — REST routes', () => {
  function routePaths(router) {
    return router.stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  }

  it('mounts POST /thread-from-text (Epic 4 thread-from-text)', () => {
    const paths = routePaths(writerRouter);
    expect(paths).toContain('POST /thread-from-text');
  });

  it('mounts POST /bio (Epic 4 bio generator)', () => {
    const paths = routePaths(writerRouter);
    expect(paths).toContain('POST /bio');
  });

  it('mounts POST /generate with tone support (Epic 4 tone selector)', () => {
    const paths = routePaths(writerRouter);
    expect(paths).toContain('POST /generate');
  });
});

// ----------------------------------------------------------------------------
// Tier 2 — Gated by env key: real LLM calls (no mocks/stubs/fakes)
// ----------------------------------------------------------------------------

describeWithKey('EPS-4 AI Tweet Writer — real LLM integration', () => {
  it('generateTweet returns up to 5 tweet variations', async () => {
    const result = await generateTweet(voiceProfile, { topic: 'why shipping fast beats perfection', count: 5 });
    expect(result.tweets).toBeInstanceOf(Array);
    expect(result.tweets.length).toBeGreaterThan(0);
    expect(result.tweets.length).toBeLessThanOrEqual(5);
    expect(typeof result.tweets[0].text).toBe('string');
    expect(result.tweets[0].text.length).toBeLessThanOrEqual(280);
    expect(result.model).toBeTruthy();
  }, 60000);

  it('generateTweet honors the funny tone selector', async () => {
    const result = await generateTweet(voiceProfile, { topic: 'monday mornings', tone: 'funny', count: 3 });
    expect(result.tone).toBe('funny');
    expect(result.tweets.length).toBeGreaterThan(0);
  }, 60000);

  it('generateThreadFromText auto-splits long text into a thread', async () => {
    const longText = [
      'Shipping fast is the only sustainable advantage for small teams.',
      'Perfectionism is a tax you pay upfront for features nobody asked for.',
      'The best marketing is a working product in users hands.',
      'Roadmaps are fiction; shipped code is reality.',
      'Every delay compounds: the market moves, the team demoralizes, the moat shrinks.',
    ].join(' ');
    const result = await generateThreadFromText(voiceProfile, { text: longText, maxLength: 6 });
    expect(result.thread).toBeInstanceOf(Array);
    expect(result.thread.length).toBeGreaterThan(0);
    expect(result.thread.length).toBeLessThanOrEqual(6);
    expect(typeof result.thread[0].text).toBe('string');
    expect(result.sourceLength).toBe(longText.length);
  }, 60000);

  it('generateBio returns bio options under the 160-char limit', async () => {
    const result = await generateBio(voiceProfile, { topic: 'indie hacker building dev tools', count: 5, maxLength: 160 });
    expect(result.bios).toBeInstanceOf(Array);
    expect(result.bios.length).toBeGreaterThan(0);
    expect(result.bios.length).toBeLessThanOrEqual(10);
    for (const b of result.bios) {
      expect(typeof b.text).toBe('string');
      expect(b.text.length).toBeLessThanOrEqual(160);
    }
  }, 60000);
});
