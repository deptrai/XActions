// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Session management schemas — Story 46.2 pilot mount `/api/session` (bearerAuth).
 *
 * NOTE: `POST /api/session/save-session` takes `sessionCookie` as **payload**
 * (the cookie value to encrypt+store) — the sessionCookieShim is NOT mounted
 * there; the body schema validates it as a required string.
 *
 * @module api/schemas/session
 */

import { z } from 'zod';
import { registerPath } from './registry.js';

// ── Request bodies ───────────────────────────────────────────────────────────

export const SaveSessionBody = z.object({
  sessionCookie: z.string().min(1).describe('X/Twitter auth_token cookie value to store'),
  username: z.string().optional(),
});

// ── Response payloads ────────────────────────────────────────────────────────

export const SaveSessionResponse = z.looseObject({
  message: z.string(),
  authMethod: z.string(),
});

export const RemoveSessionResponse = z.looseObject({
  message: z.string(),
});

export const AuthMethodResponse = z.looseObject({
  authMethod: z.string().nullable(),
  hasOAuth: z.boolean(),
  hasSession: z.boolean(),
  username: z.string().nullable().optional(),
});

// ── Operation registrations ──────────────────────────────────────────────────

const BEARER = [{ bearerAuth: [] }];

registerPath({
  method: 'post',
  path: '/api/session/save-session',
  summary: 'Save a session cookie for browser automation',
  tags: ['Session'],
  schemas: { body: SaveSessionBody, response: SaveSessionResponse },
  security: BEARER,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'delete',
  path: '/api/session/remove-session',
  summary: 'Remove the stored session cookie (switch back to OAuth)',
  tags: ['Session'],
  schemas: { response: RemoveSessionResponse },
  security: BEARER,
  xTryItOut: false,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/session/auth-method',
  summary: 'Get the current authentication method',
  tags: ['Session'],
  schemas: { response: AuthMethodResponse },
  security: BEARER,
  errors: [401, 404, 500],
});
