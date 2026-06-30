-- EPS-3 Analytics Dashboard — per-tweet metrics captured at a point in time.
-- One row per (tweetId, snapshotAt); the dashboard ranks the latest snapshot per tweet.

-- CreateTable
CREATE TABLE "TweetSnapshot" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "text" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "retweets" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "quotes" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
    "tweetedAt" TIMESTAMP(3),
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TweetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TweetSnapshot_username_snapshotAt_idx" ON "TweetSnapshot"("username", "snapshotAt");

-- CreateIndex
CREATE INDEX "TweetSnapshot_username_tweetId_idx" ON "TweetSnapshot"("username", "tweetId");

-- CreateIndex
CREATE INDEX "TweetSnapshot_tweetId_snapshotAt_idx" ON "TweetSnapshot"("tweetId", "snapshotAt");

-- EPS-3 Analytics Dashboard — daily engagement roll-up per username.
-- Upserted on (username, date) so re-runs replace the day's aggregate.

-- CreateTable
CREATE TABLE "EngagementDaily" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "avgEngagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalImpressions" INTEGER NOT NULL DEFAULT 0,
    "totalEngagements" INTEGER NOT NULL DEFAULT 0,
    "topTweetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngagementDaily_username_date_key" ON "EngagementDaily"("username", "date");

-- CreateIndex
CREATE INDEX "EngagementDaily_username_date_idx" ON "EngagementDaily"("username", "date");
