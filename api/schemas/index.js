// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Schema barrel — Story 46.2 (Epic 46).
 *
 * `api/openapi.js` imports this barrel so every schema module evaluates and
 * populates the shared `OpenAPIRegistry`. Route files import the individual
 * schema objects they validate against (e.g. `import { ViralMineBody } from
 * '../schemas/viral.js'`).
 *
 * @module api/schemas
 */

export * from './common.js';
export * from './registry.js';
export * from './viral.js';
export * from './crm.js';
export * from './optimizer.js';
export * from './checkpoints.js';
export * from './session.js';
export * from './auth.js';

// Story 46.4 — Social & User-Facing Mounts
export * from './social-posting.js';
export * from './social-engagement.js';
export * from './social-account.js';
export * from './social-discovery.js';
export * from './social-facebook.js';
