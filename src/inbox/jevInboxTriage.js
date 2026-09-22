// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Inbox Triage (Story 43.3)
// Semantic DM intent classification + toxicity + priority scoring.
// by nichxbt

import { JevBrain } from '../agents/jevBrain.js';

/**
 * Triage a single DM conversation via Jev typed decision.
 *
 * One `decide()` call with three questions:
 *   - `intent`   — Choice: what's the sender's intent?
 *   - `toxic`    — Noul: harassment/threats/scam probability.
 *   - `priority` — Score 0-3: response urgency.
 *
 * Action mapping:
 *   - toxic.noul >= 0.5 OR intent='spam' → 'ignore'
 *   - intent='lead' AND priority >= 3    → 'escalate'
 *   - intent ∈ ['lead','support','friend'] AND priority >= 2 → 'reply'
 *   - otherwise → 'review'
 *
 * Degraded → `{intent:'unknown', toxic:0, priority:0, action:'review'}`.
 *
 * @param {{name?: string, lastMessage?: string, time?: string, unread?: boolean}} conv
 * @param {Object} [options]
 * @param {JevBrain} [options.brain]
 * @returns {Promise<{name: string, lastMessage: string, time: string, unread: boolean, intent: string, intentConfidence: number, toxic: number, priority: number, priorityConfidence: number, action: 'reply'|'ignore'|'escalate'|'review'}>}
 */
export async function triageConversation(conv, { brain } = {}) {
  const name = conv?.name || conv?.username || 'unknown';
  const lastMessage = conv?.lastMessage || '';
  const time = conv?.time || '';
  const unread = conv?.unread ?? false;

  if (!lastMessage.trim()) {
    return { name, lastMessage, time, unread, intent: 'unknown', intentConfidence: 0, toxic: 0, priority: 0, priorityConfidence: 0, action: 'review' };
  }

  const jev = brain || new JevBrain({});

  const decision = await jev.decide(
    { sender: name, message: lastMessage, context: 'DM inbox' },
    {
      intent: {
        type: 'choice',
        instructions: 'What is the sender\'s intent in this direct message?',
        criteria: {
          spam: 'Unsolicited promotion, scam, or mass-sent message',
          lead: 'Potential customer or business inquiry',
          support: 'Asking for help with a product or service',
          friend: 'Personal/friendly message from someone they know',
          ignore: 'Not actionable — bot, notification, or irrelevant',
        },
      },
      toxic: {
        type: 'noul',
        instructions: 'This message contains harassment, threats, scam content, or violates safety policies',
      },
      priority: {
        type: 'score',
        instructions: 'How urgently does this message need a response?',
        criteria: ['never respond', 'low priority', 'respond soon', 'urgent — respond immediately'],
      },
    },
  );

  if (decision.meta.degraded) {
    return { name, lastMessage, time, unread, intent: 'unknown', intentConfidence: 0, toxic: 0, priority: 0, priorityConfidence: 0, action: 'review' };
  }

  const intent = decision.answers.intent || {};
  const toxic = decision.answers.toxic?.noul ?? 0;
  const priority = decision.answers.priority || {};

  const intentChoice = intent.choice ?? 'ignore';
  const intentConf = intent.confidence ?? 0;
  const priorityScore = priority.score ?? 0;
  const priorityConf = priority.confidence ?? 0;

  // Action mapping
  let action = 'review';
  if (toxic >= 0.5 || intentChoice === 'spam') {
    action = 'ignore';
  } else if (intentChoice === 'lead' && priorityScore >= 3) {
    action = 'escalate';
  } else if (['lead', 'support', 'friend'].includes(intentChoice) && priorityScore >= 2) {
    action = 'reply';
  }

  return {
    name, lastMessage, time, unread,
    intent: intentChoice,
    intentConfidence: intentConf,
    toxic,
    priority: priorityScore,
    priorityConfidence: priorityConf,
    action,
  };
}

/**
 * Batch-triage a list of DM conversations.
 * Sequential processing (Jev ~300ms/conversation).
 *
 * @param {Array<{name?: string, lastMessage?: string, time?: string, unread?: boolean}>} conversations
 * @param {Object} [options]
 * @param {JevBrain} [options.brain]
 * @returns {Promise<{triaged: Array, stats: {total: number, reply: number, escalate: number, ignore: number, review: number, degraded: boolean}}>}
 */
export async function triageInbox(conversations, { brain } = {}) {
  const triaged = [];
  const stats = { total: 0, reply: 0, escalate: 0, ignore: 0, review: 0, degraded: true };
  let anyNonDegraded = false;

  for (const conv of conversations || []) {
    const result = await triageConversation(conv, { brain });
    triaged.push(result);
    stats[result.action]++;
    if (result.intent !== 'unknown') anyNonDegraded = true;

    const emoji = result.action === 'escalate' ? '🚨' : result.action === 'reply' ? '💬' : result.action === 'ignore' ? '🚫' : '⏸️';
    console.log(`   ${emoji} @${result.name} intent=${result.intent} priority=${result.priority} → ${result.action}`);
  }

  stats.total = triaged.length;
  stats.degraded = !anyNonDegraded && triaged.length > 0;
  return { triaged, stats };
}
