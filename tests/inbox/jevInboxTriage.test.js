// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — jevInboxTriage Tests (Story 43.3)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { triageConversation, triageInbox } from '../../src/inbox/jevInboxTriage.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 60, output_tokens: 25 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

function makeBrain() {
  return new JevBrain({ apiKey: 'test-jev-key' });
}

describe('jevInboxTriage.triageConversation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('escalates high-value leads with urgent priority', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      intent: { type: 'choice', choice: 'lead', confidence: 0.92 },
      toxic: { type: 'noul', noul: 0.05 },
      priority: { type: 'score', score: 3, confidence: 0.88 },
    }));
    const result = await triageConversation(
      { name: 'buyer', lastMessage: 'Need enterprise pricing for 50 seats' },
      { brain: makeBrain() },
    );
    expect(result.intent).toBe('lead');
    expect(result.priority).toBe(3);
    expect(result.action).toBe('escalate');
  });

  it('replies to support inquiries with medium priority', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      intent: { type: 'choice', choice: 'support', confidence: 0.9 },
      toxic: { type: 'noul', noul: 0.02 },
      priority: { type: 'score', score: 2, confidence: 0.85 },
    }));
    const result = await triageConversation(
      { name: 'user1', lastMessage: 'How do I export my data?' },
      { brain: makeBrain() },
    );
    expect(result.intent).toBe('support');
    expect(result.action).toBe('reply');
  });

  it('ignores spam DMs', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      intent: { type: 'choice', choice: 'spam', confidence: 0.95 },
      toxic: { type: 'noul', noul: 0.1 },
      priority: { type: 'score', score: 0, confidence: 0.9 },
    }));
    const result = await triageConversation(
      { name: 'spammer', lastMessage: 'Earn $500/day guaranteed work from home!' },
      { brain: makeBrain() },
    );
    expect(result.action).toBe('ignore');
  });

  it('ignores toxic messages regardless of intent', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      intent: { type: 'choice', choice: 'friend', confidence: 0.7 },
      toxic: { type: 'noul', noul: 0.85 },
      priority: { type: 'score', score: 1, confidence: 0.7 },
    }));
    const result = await triageConversation(
      { name: 'bad_actor', lastMessage: 'hateful threats here' },
      { brain: makeBrain() },
    );
    expect(result.action).toBe('ignore');
    expect(result.toxic).toBeGreaterThanOrEqual(0.5);
  });

  it('routes low-priority friendly message to review', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      intent: { type: 'choice', choice: 'friend', confidence: 0.8 },
      toxic: { type: 'noul', noul: 0.01 },
      priority: { type: 'score', score: 1, confidence: 0.7 },
    }));
    const result = await triageConversation(
      { name: 'buddy', lastMessage: 'hey, how is it going?' },
      { brain: makeBrain() },
    );
    expect(result.action).toBe('review');
  });

  it('returns review when lastMessage is empty (no Jev call)', async () => {
    const result = await triageConversation({ name: 'empty', lastMessage: '' }, { brain: makeBrain() });
    expect(result.action).toBe('review');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns review when Jev degraded', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const result = await triageConversation({ name: 'x', lastMessage: 'text' }, { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(result.action).toBe('review');
    expect(result.intent).toBe('unknown');
  });
});

describe('jevInboxTriage.triageInbox', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('triages a batch of conversations and produces stats', async () => {
    mockFetch
      // 1. Lead
      .mockResolvedValueOnce(mockJevSuccess({
        intent: { type: 'choice', choice: 'lead', confidence: 0.9 },
        toxic: { type: 'noul', noul: 0.05 },
        priority: { type: 'score', score: 3, confidence: 0.9 },
      }))
      // 2. Spam
      .mockResolvedValueOnce(mockJevSuccess({
        intent: { type: 'choice', choice: 'spam', confidence: 0.95 },
        toxic: { type: 'noul', noul: 0.1 },
        priority: { type: 'score', score: 0, confidence: 0.9 },
      }))
      // 3. Support
      .mockResolvedValueOnce(mockJevSuccess({
        intent: { type: 'choice', choice: 'support', confidence: 0.9 },
        toxic: { type: 'noul', noul: 0.02 },
        priority: { type: 'score', score: 2, confidence: 0.85 },
      }));

    const { triaged, stats } = await triageInbox(
      [
        { name: 'buyer', lastMessage: 'pricing' },
        { name: 'bot', lastMessage: 'free crypto' },
        { name: 'user', lastMessage: 'help me' },
      ],
      { brain: makeBrain() },
    );

    expect(triaged).toHaveLength(3);
    expect(stats.total).toBe(3);
    expect(stats.escalate).toBe(1);
    expect(stats.ignore).toBe(1);
    expect(stats.reply).toBe(1);
    expect(stats.degraded).toBe(false);
  });

  it('handles empty inbox', async () => {
    const { triaged, stats } = await triageInbox([], { brain: makeBrain() });
    expect(triaged).toEqual([]);
    expect(stats.total).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
