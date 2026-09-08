-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScraperHealthScore_platform_evaluatedAt_idx" ON "ScraperHealthScore"("platform", "evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScraperHealthScore_scraperId_evaluatedAt_idx" ON "ScraperHealthScore"("scraperId", "evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_platform_executedAt_idx" ON "ScraperCanaryRun"("platform", "executedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_scraperId_executedAt_idx" ON "ScraperCanaryRun"("scraperId", "executedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScraperHealthScore_evaluatedAt_idx" ON "ScraperHealthScore"("evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_executedAt_idx" ON "ScraperCanaryRun"("executedAt" DESC);
