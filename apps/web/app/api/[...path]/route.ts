// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * BFF catch-all route handler.
 * Maps any same-origin /api/* call to the backend upstream.
 */

import { proxyToBackend } from '@/lib/proxy';

export async function GET(req: Request) {
  return proxyToBackend(req);
}

export async function POST(req: Request) {
  return proxyToBackend(req);
}

export async function PUT(req: Request) {
  return proxyToBackend(req);
}

export async function DELETE(req: Request) {
  return proxyToBackend(req);
}

export async function PATCH(req: Request) {
  return proxyToBackend(req);
}

export async function HEAD(req: Request) {
  return proxyToBackend(req);
}

export async function OPTIONS(req: Request) {
  return proxyToBackend(req);
}
