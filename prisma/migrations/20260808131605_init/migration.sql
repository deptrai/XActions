-- Reconstructed init migration (tables were created out-of-band on dev DBs via
-- `prisma db push` before this file existed; the live database records
-- 20260808131605_init as applied). CREATE TABLE IF NOT EXISTS keeps it safe to
-- replay on databases where the tables already exist.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Post" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "authorUrl" TEXT,
    "postUrl" TEXT,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "repostsCount" INTEGER NOT NULL DEFAULT 0,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "publishedAt" TIMESTAMP(3),
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Comment" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "content" TEXT NOT NULL,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "subCommentsCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "publishedAt" TIMESTAMP(3),
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CrawlCheckpoint" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "lastCursor" TEXT,
    "lastTimestamp" TIMESTAMP(3),
    "lastCrawledAt" TIMESTAMP(3),
    "nextScheduledAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storageRef" TEXT,

    CONSTRAINT "CrawlCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_authorId_idx" ON "Post"("authorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_category_crawledAt_idx" ON "Post"(category, "crawledAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_crawledAt_idx" ON "Post"("crawledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_platform_crawledAt_idx" ON "Post"(platform, "crawledAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Post_platform_externalId_key" ON "Post"(platform, "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_crawledAt_idx" ON "Comment"("crawledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_postId_parentCommentId_idx" ON "Comment"("postId", "parentCommentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Comment_platform_externalId_postId_key" ON "Comment"(platform, "externalId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CrawlCheckpoint_platform_targetType_targetKey_key" ON "CrawlCheckpoint"(platform, "targetType", "targetKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrawlCheckpoint_platform_updatedAt_idx" ON "CrawlCheckpoint"(platform, "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CrawlCheckpoint_status_nextScheduledAt_idx" ON "CrawlCheckpoint"(status, "nextScheduledAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Comment_postId_fkey') THEN
        ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Comment_parentCommentId_fkey') THEN
        ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
