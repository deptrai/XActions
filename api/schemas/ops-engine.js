// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Operations, Agent, Workflows, Scripts, Automations schemas — Story 46.5.
 *
 * @module api/schemas/ops-engine
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const BEARER_SECURITY = [{ bearerAuth: [] }];
const SESSION_SECURITY = [{ sessionCookie: [] }];

export const StartAgentBody = z.object({
  personaId: z.string().optional(),
  niche: z.string().optional(),
  intervalMs: z.number().int().min(5000).default(60000),
  sessionCookie: z.string().optional(),
});

export const TriggerWorkflowBody = z.object({
  workflowId: nonEmptyId,
  inputs: z.record(z.unknown()).optional(),
  sessionCookie: z.string().optional(),
});

registerPath({
  method: 'get',
  path: '/api/operations',
  summary: 'List recent background automation operations',
  tags: ['Operations'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/operations/{id}',
  summary: 'Get status and logs of a specific operation',
  tags: ['Operations'],
  schemas: { params: z.object({ id: nonEmptyId }) },
  security: BEARER_SECURITY,
  errors: [401, 404, 500],
});

registerPath({
  method: 'post',
  path: '/api/agent/start',
  summary: 'Start the autonomous thought leader growth agent',
  tags: ['Agent'],
  schemas: { body: StartAgentBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'post',
  path: '/api/agent/stop',
  summary: 'Stop the running growth agent instance',
  tags: ['Agent'],
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/workflows',
  summary: 'List executable automation workflows',
  tags: ['Workflows'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/workflows/run',
  summary: 'Trigger a workflow execution',
  tags: ['Workflows'],
  schemas: { body: TriggerWorkflowBody },
  security: SESSION_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/scripts/browser',
  summary: 'List available standalone browser automation scripts',
  tags: ['Scripts'],
  security: [{}],
  errors: [500],
});
