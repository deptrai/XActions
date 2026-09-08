// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Ensures benchmark tables (ScraperHealthScore, ScraperCanaryRun) exist in PostgreSQL.
 * Safe, idempotent DDL execution for cold starts or un-migrated databases.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

let isEnsured = false;

/**
 * Execute idempotent DDL to ensure benchmark tables exist.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<boolean>}
 */
export async function ensureBenchmarkTables(prisma) {
  if (isEnsured) return true;
  if (!prisma || typeof prisma.$executeRawUnsafe !== 'function') return false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ScraperHealthScore" (
          "id" TEXT NOT NULL,
          "scraperId" TEXT NOT NULL,
          "platform" TEXT NOT NULL,
          "healthScore" DOUBLE PRECISION NOT NULL,
          "tier" TEXT NOT NULL,
          "stabilityScore" DOUBLE PRECISION NOT NULL,
          "qualityScore" DOUBLE PRECISION NOT NULL,
          "noiseScore" DOUBLE PRECISION NOT NULL,
          "costScore" DOUBLE PRECISION NOT NULL,
          "sampleCount" INTEGER NOT NULL DEFAULT 0,
          "consecutiveCleanRuns" INTEGER NOT NULL DEFAULT 0,
          "requalifiedAt" TIMESTAMP(3),
          "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "metricsSnapshot" JSONB NOT NULL,
          CONSTRAINT "ScraperHealthScore_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ScraperCanaryRun" (
          "id" TEXT NOT NULL,
          "scraperId" TEXT NOT NULL,
          "platform" TEXT NOT NULL,
          "targetUrl" TEXT NOT NULL,
          "isSuccess" BOOLEAN NOT NULL,
          "latencyMs" INTEGER NOT NULL,
          "httpStatus" INTEGER NOT NULL,
          "false200Detected" BOOLEAN NOT NULL DEFAULT false,
          "checkpointDetected" BOOLEAN NOT NULL DEFAULT false,
          "errorReason" TEXT,
          "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ScraperCanaryRun_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ScraperHealthScore_platform_evaluatedAt_idx" ON "ScraperHealthScore"("platform", "evaluatedAt" DESC);
      CREATE INDEX IF NOT EXISTS "ScraperHealthScore_scraperId_evaluatedAt_idx" ON "ScraperHealthScore"("scraperId", "evaluatedAt" DESC);
      CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_platform_executedAt_idx" ON "ScraperCanaryRun"("platform", "executedAt" DESC);
      CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_scraperId_executedAt_idx" ON "ScraperCanaryRun"("scraperId", "executedAt" DESC);
      CREATE INDEX IF NOT EXISTS "ScraperHealthScore_evaluatedAt_idx" ON "ScraperHealthScore"("evaluatedAt" DESC);
      CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_executedAt_idx" ON "ScraperCanaryRun"("executedAt" DESC);
    `);

    isEnsured = true;
    return true;
  } catch (err) {
    console.warn('[BenchmarkDB] Table initialization notice:', err?.message || String(err));
    return false;
  }
}
