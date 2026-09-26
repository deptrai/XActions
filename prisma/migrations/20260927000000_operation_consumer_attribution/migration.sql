-- Story 50.2 (D-2) — Operation consumer attribution.
-- Service-auth callers have no user row: userId becomes nullable and the
-- derived Bearer consumer_id is recorded on consumerId instead.

-- AlterTable
ALTER TABLE "Operation" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Operation" ADD COLUMN "consumerId" TEXT;

-- CreateIndex
CREATE INDEX "Operation_consumerId_idx" ON "Operation"("consumerId");
