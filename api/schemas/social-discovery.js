// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Discovery, Spaces, Graph, Platform schemas — Story 46.4.
 *
 * Covers:
 *   - /api/discovery (trends, hashtags, recommendations)
 *   - /api/spaces (search, active spaces)
 *   - /api/graph (network centrality, PageRank)
 *   - /api/platform (multi-platform status, crawler health)
 *
 * @module api/schemas/social-discovery
 */

import { z } from 'zod';
import { registerPath } from './registry.js';

const PUBLIC_SECURITY = [{}];
const SESSION_SECURITY = [{ sessionCookie: [] }];

// ── Request Schemas ─────────────────────────────────────────────────────────

export const TrendingQuery = z.object({
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GraphCentralityQuery = z.object({
  algorithm: z.enum(['pagerank', 'betweenness', 'degree']).default('pagerank'),
  handle: z.string().optional(),
});

// ── Registration ───────────────────────────────────────────────────────────

registerPath({
  method: 'get',
  path: '/api/discovery/trending',
  summary: 'Get trending topics and hashtags',
  tags: ['Discovery'],
  schemas: { query: TrendingQuery },
  security: PUBLIC_SECURITY,
  errors: [500],
});

registerPath({
  method: 'get',
  path: '/api/spaces/active',
  summary: 'Discover live Twitter Spaces',
  tags: ['Spaces'],
  security: SESSION_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/graph/centrality',
  summary: 'Compute network graph centrality metrics',
  tags: ['Graph'],
  schemas: { query: GraphCentralityQuery },
  security: SESSION_SECURITY,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/platform/status',
  summary: 'Get unified social platform scraping and crawler health',
  tags: ['Platform'],
  security: PUBLIC_SECURITY,
  errors: [500],
});
