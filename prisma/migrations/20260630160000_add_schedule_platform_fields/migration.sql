-- EPS-2 Tweet Scheduling: extend Schedule with platform discriminator + tweet-specific fields.
-- Existing rows are Facebook schedules → set platform to 'facebook' AFTER adding the column.

-- Add columns. `platform` is NOT NULL with default 'twitter' for new tweet-schedule rows;
-- existing rows pick up the default 'twitter' on ADD COLUMN, then we backfill them to 'facebook'.
ALTER TABLE "Schedule" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'twitter';
ALTER TABLE "Schedule" ADD COLUMN "thread" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "timezone" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "recurrenceCron" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "queueOrder" INTEGER NOT NULL DEFAULT 0;

-- Every row that existed before this migration is a Facebook schedule (the tweet-scheduling
-- feature is introduced by this migration). Backfill them to 'facebook' so the tweet worker's
-- `platform = 'twitter'` filter does not pick them up.
UPDATE "Schedule" SET "platform" = 'facebook' WHERE "facebookAccountId" IS NOT NULL;
-- Defensive: any remaining row without a facebookAccountId that predates this migration is
-- also a Facebook schedule (the tweet path did not exist yet).
UPDATE "Schedule" SET "platform" = 'facebook'
  WHERE "platform" = 'twitter' AND "createdAt" < '2026-06-30T16:00:00Z';

-- Index for the tweet worker's due-query: WHERE platform='twitter' AND status='pending' AND scheduledAt <= now.
CREATE INDEX "Schedule_platform_status_scheduledAt_idx" ON "Schedule"("platform", "status", "scheduledAt");
