-- CreateEnum
CREATE TYPE "SocialAccountHealthStatus" AS ENUM ('active', 'checkpoint', 'dead', 'banned');

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedCookie" TEXT,
    "encryptedProxy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccountHealth" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "SocialAccountHealthStatus" NOT NULL,
    "reason" TEXT,
    "lastCheckAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccountHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_userId_idx" ON "SocialAccount"("userId");

-- CreateIndex
CREATE INDEX "SocialAccount_platform_idx" ON "SocialAccount"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_platform_label_key" ON "SocialAccount"("userId", "platform", "label");

-- CreateIndex
CREATE INDEX "SocialAccountHealth_accountId_idx" ON "SocialAccountHealth"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccountHealth_accountId_key" ON "SocialAccountHealth"("accountId");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccountHealth" ADD CONSTRAINT "SocialAccountHealth_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
