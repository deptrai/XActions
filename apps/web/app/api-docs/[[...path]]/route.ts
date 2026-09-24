// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Swagger UI proxy route handler.
 * Maps /api-docs and /api-docs/* to backend upstream Swagger UI mount.
 */

import { proxyToBackend } from '@/lib/proxy';

export async function GET(req: Request) {
  return proxyToBackend(req);
}

export async function HEAD(req: Request) {
  return proxyToBackend(req);
}

export async function OPTIONS(req: Request) {
  return proxyToBackend(req);
}
