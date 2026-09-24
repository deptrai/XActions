// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Proxies, Governor, Benchmark, Streams, Datasets, Schemas — Story 46.5.
 *
 * @module api/schemas/ops-infrastructure
 */

import { z } from 'zod';
import { registerPath } from './registry.js';
import { nonEmptyId } from './common.js';

const BEARER_SECURITY = [{ bearerAuth: [] }];

export const AddProxyBody = z.object({
  url: z.string().min(1),
  protocol: z.enum(['http', 'https', 'socks5']).default('http'),
  country: z.string().length(2).optional(),
});

registerPath({
  method: 'get',
  path: '/api/proxies',
  summary: 'List available proxies in the dynamic pool',
  tags: ['Infrastructure'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'post',
  path: '/api/proxies',
  summary: 'Add a new proxy node to the rotation pool',
  tags: ['Infrastructure'],
  schemas: { body: AddProxyBody },
  security: BEARER_SECURITY,
  xTryItOut: false,
  errors: [400, 401, 500],
});

registerPath({
  method: 'get',
  path: '/api/governor/status',
  summary: 'Get dynamic rate limiter and account governor metrics',
  tags: ['Infrastructure'],
  security: [{}],
  errors: [500],
});

registerPath({
  method: 'get',
  path: '/api/benchmark/summary',
  summary: 'Get scraping benchmark latency and accuracy metrics',
  tags: ['Infrastructure'],
  security: [{}],
  errors: [500],
});

registerPath({
  method: 'get',
  path: '/api/datasets',
  summary: 'List downloadable scraped social intelligence datasets',
  tags: ['Infrastructure'],
  security: BEARER_SECURITY,
  errors: [401, 500],
});

registerPath({
  method: 'get',
  path: '/api/schemas/registry',
  summary: 'Inspect registered runtime contract validation schemas',
  tags: ['Infrastructure'],
  security: [{}],
  errors: [500],
});
