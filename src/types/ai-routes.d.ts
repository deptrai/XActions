/// <reference types="node" />

export {};

declare global {
  interface ScrapedUser {
    username?: string;
    name?: string;
    displayName?: string;
    bio?: string;
    verified?: boolean;
    followsBack?: boolean;
    followsYou?: boolean;
    profileImage?: string;
    profileImageUrl?: string;
    followers?: string | number;
    following?: string | number;
  }

  interface ScrapedTweet {
    id?: string;
    text?: string;
    timestamp?: string;
    createdAt?: string;
    url?: string;
    likes?: string | number;
    retweets?: string | number;
    replies?: string | number;
    views?: string | number;
    quotes?: string | number;
    bookmarks?: string | number;
    media?: ScrapedMedia[];
    isReply?: boolean;
    isRetweet?: boolean;
    isQuote?: boolean;
    replyToUser?: string;
    quotedTweetId?: string;
    author?: ScrapedUser;
    username?: string;
    authorName?: string;
    metrics?: Record<string, unknown>;
  }

  interface ScrapedMedia {
    type?: string;
    url?: string;
    thumbnailUrl?: string;
    tweetId?: string;
    tweetUrl?: string;
    timestamp?: string;
    dimensions?: Record<string, unknown>;
    duration?: number;
    thumbnail?: string;
  }

  interface ScrapedBookmark {
    id?: string;
    text?: string;
    author?: ScrapedUser;
    timestamp?: string;
    createdAt?: string;
    likes?: string | number;
    retweets?: string | number;
    replies?: string | number;
    url?: string;
    bookmarkedAt?: string;
    username?: string;
    authorName?: string;
  }

  interface UserListResult {
    users?: ScrapedUser[];
    nextCursor?: string | null;
  }

  interface TweetListResult {
    items?: ScrapedTweet[];
    nextCursor?: string | null;
  }

  interface MediaListResult {
    items?: ScrapedMedia[];
    nextCursor?: string | null;
  }

  interface BookmarkListResult {
    items?: ScrapedBookmark[];
    nextCursor?: string | null;
  }

  interface ThreadResult {
    author?: ScrapedUser;
    tweets?: ScrapedTweet[];
  }

  interface ScrapedProfile extends ScrapedUser {
    bio?: string;
    website?: string;
    location?: string;
    joinDate?: string;
    protected?: boolean;
    bannerImage?: string;
    verifiedType?: string;
    affiliatedLabel?: string;
    followersCount?: number;
    followingCount?: number;
    postsCount?: number;
    tweets?: string | number;
  }

  interface MonitoringSnapshot {
    id: string;
    username?: string;
    type?: string;
    createdAt: string | Date;
    stats?: Record<string, unknown> | null;
    followerCount?: number;
    followingCount?: number;
    includesFollowersList?: boolean;
    followers?: string[];
    includesFollowingList?: boolean;
    following?: string[];
  }

  interface ComparisonResult {
    username: string;
    snapshot1: MonitoringSnapshot;
    snapshot2: MonitoringSnapshot;
    followersGained?: string[];
    followersLost?: string[];
    followingAdded?: string[];
    followingRemoved?: string[];
    timeBetweenHuman?: string;
  }

  interface QueueJob {
    id: string;
    type?: string;
    status?: string;
    progress?: number;
    result?: Record<string, unknown> | null;
    error?: Record<string, unknown> | null;
    config?: Record<string, unknown>;
    createdAt?: string;
    startedAt?: string;
    updatedAt?: string;
    completedAt?: string | null;
    source?: string;
  }

  interface VoiceProfile {
    username?: string;
    tweetCount: number;
    totalTweetsAnalyzed?: number;
    analyzedAt?: string;
    style?: {
      avgLength?: number;
      medianLength?: number;
      emojiRate?: number;
      hashtagRate?: number;
      questionRate?: number;
      threadRate?: number;
      urlRate?: number;
      mentionRate?: number;
    };
    tone?: {
      formality?: number;
      humor?: number;
      controversy?: number;
      technicality?: number;
    };
    vocabulary?: {
      topWords?: Array<{ word: string; count: number }>;
      topPhrases?: Array<{ word: string; count: number }>;
      sentenceStarters?: Array<{ word: string; count: number }>;
    };
    contentPillars: Array<{ topic: string; frequency?: number; matchScore?: number; tweetCount?: number; avgEngagement?: number }>;
    bestPerforming?: {
      commonTraits?: string[];
      examples?: Array<{
        text?: string;
        engagement?: number;
        likes?: number;
        retweets?: number;
        replies?: number;
      }>;
    };
  }

  interface VideoVariant {
    url?: string;
    quality?: string;
    bitrate?: number;
    contentType?: string;
  }

  interface SpaceTranscriptEntry {
    speaker: string;
    text: string;
  }

  interface ExportPortability {
    followers?: { username: string }[];
    tweets?: unknown[];
  }
}
