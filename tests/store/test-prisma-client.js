// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared PrismaClient for integration tests against a real test database.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PrismaClient } from '@prisma/client';

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ||
  'postgresql://postgres:postgres@localhost:5434/xactions_test?schema=public';

export const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

/** Remove all Post / Comment / CrawlCheckpoint rows from the test database. */
export async function cleanupTestDatabase() {
  try {
    await prisma.$executeRaw`TRUNCATE TABLE "CrawlCheckpoint" CASCADE;`;
    await prisma.$executeRaw`TRUNCATE TABLE "Post" CASCADE;`;
  } catch {}
}
