// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Auth schemas — Story 46.2 pilot mount `/api/auth` (public endpoints).
 * Replaces the previous express-validator chains.
 *
 * @module api/schemas/auth
 */

import { z } from 'zod';
import { registerPath } from './registry.js';

// ── Request bodies ───────────────────────────────────────────────────────────

export const RegisterBody = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers and underscores'),
  password: z.string().min(8),
  email: z.preprocess(
    (v) => (typeof v === 'string' ? (v.length === 0 ? undefined : v.toLowerCase()) : v),
    z.email().optional()
  ),
});

export const LoginBody = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export const RefreshBody = z.object({
  token: z.string().min(1),
});

// ── Response payloads ────────────────────────────────────────────────────────

export const AuthUser = z.looseObject({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable().optional(),
});

export const AuthTokenResponse = z.looseObject({
  token: z.string(),
  user: AuthUser.optional(),
});

export const RefreshResponse = z.looseObject({
  token: z.string(),
});

// ── Operation registrations ──────────────────────────────────────────────────

const PUBLIC = [{}];

registerPath({
  method: 'post',
  path: '/api/auth/register',
  summary: 'Register a new user (email optional)',
  tags: ['Auth'],
  schemas: { body: RegisterBody, response: AuthTokenResponse },
  statusCode: 201,
  security: PUBLIC,
  errors: [400, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Log in with username or email',
  tags: ['Auth'],
  schemas: { body: LoginBody, response: AuthTokenResponse },
  security: PUBLIC,
  errors: [400, 401, 429, 500],
});

registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  summary: 'Refresh a JWT within 24h of expiry',
  tags: ['Auth'],
  schemas: { body: RefreshBody, response: RefreshResponse },
  security: PUBLIC,
  errors: [400, 401, 429, 500],
});
