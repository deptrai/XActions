// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Agent-to-Agent (A2A) Task Delegation Routes
 *
 * Allows external AI agents to discover XActions skills and submit tasks
 * using the A2A protocol task envelope format.
 *
 * Routes:
 *   GET  /api/a2a/skills  — list all registered skills (free, no payment)
 *   POST /api/a2a/task    — submit a task, returns operationId for polling
 *   GET  /api/a2a/stream  — SSE stream of A2A bus activity (dashboard monitor)
 *   POST /api/a2a/send    — publish a message onto the A2A bus
 *
 * @author nichxbt
 */

import { Router } from 'express';
import { errorResponse } from '../utils/errorResponse.js';

const router = Router();

/**
 * In-process A2A message bus for the dashboard monitor.
 * Recent messages are kept in a ring buffer so SSE clients that connect late
 * still see the latest activity. Real A2A task submissions also publish here.
 * @type {Array<Record<string, unknown>>}
 */
const recentMessages = [];
const MAX_BUFFERED = 100;

/** @type {Set<import('express').Response>} */
const sseClients = new Set();

/**
 * Publish an A2A message to the ring buffer and all connected SSE clients.
 * @param {Record<string, unknown>} msg
 */
function publishMessage(msg) {
  recentMessages.push(msg);
  if (recentMessages.length > MAX_BUFFERED) recentMessages.shift();
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* client gone */ }
  }
}

/**
 * GET /api/a2a/stream
 * Server-Sent Events stream of A2A bus activity for the dashboard monitor.
 * Replays the recent buffer on connect, then pushes live messages.
 */
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'system', content: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  for (const msg of recentMessages) {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(`:hb\n\n`); } catch { /* closed */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

/**
 * POST /api/a2a/send
 * Accept a dashboard-originated message and broadcast it on the A2A bus so
 * the SSE monitor (and any other connected clients) see it.
 */
router.post('/send', (req, res) => {
  const body = /** @type {Record<string, unknown>} */ (req.body || {});
  const msg = {
    id: body.id || `srv-${Date.now()}`,
    from: body.from || 'orchestrator',
    to: body.to || 'broadcast',
    content: body.content || '',
    timestamp: body.timestamp || new Date().toISOString(),
    type: body.type || 'request',
  };
  publishMessage(msg);
  return res.json({ success: true, delivered: sseClients.size, message: msg });
});

/**
 * GET /api/a2a/skills
 * Returns the XActions skill registry for agent discovery.
 * Free — no x402 payment required.
 */
router.get('/skills', async (req, res) => {
  try {
    const { getAllSkills } = await import('../../src/a2a/skillRegistry.js');
    const skills = getAllSkills();
    return res.json({
      success: true,
      data: {
        agent: 'XActions',
        version: '2.0.0',
        skills,
        count: skills.length,
        taskEndpoint: '/api/a2a/task',
        docs: 'https://xactions.app/docs/a2a',
      },
    });
  } catch (err) {
    return errorResponse(res, 503, 'SKILLS_UNAVAILABLE', (err instanceof Error ? err.message : String(err)), { retryable: true });
  }
});

/**
 * POST /api/a2a/task
 * Accept an A2A task envelope and route it to the Bull job queue.
 *
 * Body (A2A Task Envelope):
 *   id          {string}  optional  Client-supplied idempotency key
 *   skill       {string}  required  A2A skill ID (e.g. 'xactions.x_unfollow_non_followers')
 *   input       {object}  required  Skill input parameters (sessionCookie, config, …)
 *   callbackUrl {string}  optional  Webhook URL — result is POSTed here on completion
 *   contextId   {string}  optional  Conversation/thread ID for multi-step workflows
 */
router.post('/task', async (req, res) => {
  const { id, skill, input, callbackUrl, contextId } = /** @type {{
    id?: string;
    skill: string;
    input: Record<string, unknown>;
    callbackUrl?: string;
    contextId?: string;
  }} */ (req.body);

  if (!skill) {
    return errorResponse(res, 400, 'INVALID_INPUT', 'skill is required', { retryable: false });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return errorResponse(res, 400, 'INVALID_INPUT', 'input must be a plain object', { retryable: false });
  }
  if (callbackUrl) {
    try {
      const u = new URL(callbackUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    } catch {
      return errorResponse(res, 400, 'INVALID_INPUT', 'callbackUrl must be a valid http/https URL', { retryable: false });
    }
  }

  try {
    const { getAllSkills } = await import('../../src/a2a/skillRegistry.js');
    const skills = getAllSkills();
    const skillDef = skills.find(s => s.id === skill || s.name === skill);

    if (!skillDef) {
      return errorResponse(res, 404, 'SKILL_NOT_FOUND', `Skill "${skill}" is not registered`, {
        retryable: false,
        availableSkills: skills.map(s => s.id || s.name),
        hint: 'GET /api/a2a/skills for a full list',
      });
    }

    const jobType = skillToJobType(skill);
    const { addJob } = await import('../services/jobQueue.js');

    const { jobId } = await addJob(jobType, {
      config: { ...input, callbackUrl: callbackUrl || null },
      a2aTaskId: id || null,
      a2aSkill: skill,
      contextId: contextId || null,
      source: 'a2a',
    });

    return res.status(202).json({
      success: true,
      data: {
        taskId: jobId,
        a2aTaskId: id || null,
        skill,
        status: 'queued',
        polling: {
          endpoint: `/api/ai/action/status/${jobId}`,
          recommendedIntervalMs: 5000,
        },
        streaming: {
          event: 'job:join',
          room: jobId,
          description: 'Emit job:join with the taskId over WebSocket for live progress',
        },
      },
      meta: { createdAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error('❌ A2A task error:', err);
    return errorResponse(res, 500, 'TASK_FAILED', (err instanceof Error ? err.message : String(err)));
  }
});

/**
 * Map an A2A skill ID to a Bull job type name.
 * Convention: 'xactions.x_unfollow_non_followers' → 'unfollowNonFollowers'
 */
/**
 * @param {string} skillId
 * @returns {string}
 */
function skillToJobType(skillId) {
  const raw = skillId
    .replace(/^xactions\.x_/, '')   // strip 'xactions.x_' prefix
    .replace(/^x_/, '');            // strip plain 'x_' prefix
  return raw.replace(/_([a-z])/g, (/** @type {string} */ _, /** @type {string} */ c) => c.toUpperCase());
}

export default router;
