/// <reference lib="dom" />

/**
 * Generic envelope returned by the X/Twitter API v2.
 */
interface TwitterApiEnvelope {
  data?: unknown;
  includes?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/**
 * User object as returned by the X/Twitter API v2.
 */
interface TwitterApiUser {
  id: string;
  username?: string;
  name?: string;
  public_metrics?: {
    followers_count?: number;
  };
}

/**
 * Tweet object as returned by the X/Twitter API v2.
 */
interface TwitterApiTweet {
  id: string;
  text?: string;
  author_id?: string;
}
