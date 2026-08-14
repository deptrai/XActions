-- CreateEnum FacebookAccountHealthStatus (idempotent for db-push baselines)
DO $$ BEGIN
    CREATE TYPE "FacebookAccountHealthStatus" AS ENUM ('active', 'checkpoint', 'dead');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add missing columns to FacebookAccount (idempotent)
ALTER TABLE "FacebookAccount" ADD COLUMN IF NOT EXISTS "encryptedProxy" TEXT;
ALTER TABLE "FacebookAccount" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable FacebookAccountHealth (idempotent)
CREATE TABLE IF NOT EXISTS "FacebookAccountHealth" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "FacebookAccountHealthStatus" NOT NULL,
    "reason" TEXT,
    "lastCheckAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookAccountHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "FacebookAccountHealth_accountId_key" ON "FacebookAccountHealth"("accountId");
CREATE INDEX IF NOT EXISTS "FacebookAccountHealth_accountId_idx" ON "FacebookAccountHealth"("accountId");

-- AddForeignKey (idempotent)
DO $$ BEGIN
    ALTER TABLE "FacebookAccountHealth" ADD CONSTRAINT "FacebookAccountHealth_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FacebookAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
