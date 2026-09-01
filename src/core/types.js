// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared types for the universal scraping core.
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * @typedef {Object} PostItem
 * @property {string} id - Namespaced id: `${platform}:${externalId}`
 * @property {string} platform
 * @property {string} externalId
 * @property {string} category
 * @property {string} authorId
 * @property {string} authorName
 * @property {string | null} [authorAvatar]
 * @property {string} [authorUrl]
 * @property {string} [postUrl]
 * @property {string} content
 * @property {string[]} [mediaUrls]
 * @property {number} [likesCount]
 * @property {number} [repostsCount]
 * @property {number} [repliesCount]
 * @property {number} [viewsCount]
 * @property {Object} [metadata]
 * @property {Date | null} [publishedAt]
 * @property {Date} crawledAt
 */

/**
 * @typedef {Object} CommentItem
 * @property {string} id - Namespaced id: `${platform}:${postExternalId}:${commentExternalId}`
 * @property {string} platform
 * @property {string} externalId
 * @property {string} postId
 * @property {string} [parentCommentId]
 * @property {number} [depth]
 * @property {string} authorId
 * @property {string} authorName
 * @property {string | null} [authorAvatar]
 * @property {string} content
 * @property {number} [likesCount]
 * @property {number} [subCommentsCount]
 * @property {Object} [metadata]
 * @property {Date | null} [publishedAt]
 * @property {Date} crawledAt
 */

/**
 * @typedef {Object} ProfileItem
 * @property {string} id - Namespaced id: `${platform}:${externalId}`
 * @property {string} platform
 * @property {string} externalId
 * @property {string} [username]
 * @property {string} [name]
 * @property {string} [authorName]
 * @property {string} [bio]
 * @property {string} [avatar]
 * @property {string} [profileUrl]
 * @property {number} [followersCount]
 * @property {number} [followingCount]
 * @property {Object} [metadata]
 * @property {Date} crawledAt
 */

/**
 * @typedef {Object} LoginResult
 * @property {string} accountId
 * @property {string | Record<string, unknown>} cookies
 * @property {Record<string, unknown>} tokens
 * @property {Date | string} [expiresAt]
 * @property {string} [cdpUrl]
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {Object} CrawlerCommand
 * @property {string} action
 * @property {{ accountId?: string, [key: string]: unknown }} [args]
 * @property {{ accountId?: string, [key: string]: unknown }} [session]
 * @property {string} [platform]
 */

/**
 * @typedef {Object} AccountRecord
 * @property {string} platform
 * @property {string} accountId
 * @property {Record<string, unknown> | null} credentials
 * @property {unknown} assignedProxy
 * @property {number | null} hibernatingUntil
 */

/**
 * @typedef {Object} ActionDescriptor
 * @property {string} action
 * @property {string} [category]
 * @property {string} [description]
 * @property {string[]} [requiredArgs]
 * @property {string[]} [optionalArgs]
 * @property {Object} [example]
 * @property {string} [outputType]
 * @property {boolean} [requiresAuth]
 */

/**
 * Dual-pool partition name (AD-20).
 * @typedef {'realtime' | 'bulk'} PoolName
 */

/**
 * Dual-pool partition statistics (AD-20) — per-pool totals plus the cumulative
 * count of proxies borrowed from Bulk to serve Realtime requests.
 * @typedef {Object} DualPoolStats
 * @property {{ total: number, healthy: number, quarantined: number }} realtime
 * @property {{ total: number, healthy: number, quarantined: number }} bulk
 * @property {number} yieldedCount
 */

/**
 * Consumer quota configuration (AD-20). `burstLimit` never blocks requests —
 * it only feeds `isThrottled` reporting.
 * @typedef {Object} ConsumerQuotaConfig
 * @property {string} consumerId
 * @property {number} rpmLimit - Requests per minute; Infinity means unmetered.
 * @property {number} [burstLimit]
 * @property {number} [priority]
 */

/**
 * Observability snapshot for a single consumer (AD-20).
 * @typedef {Object} ConsumerStatus
 * @property {string} consumerId
 * @property {number} rpmLimit
 * @property {number} burstLimit
 * @property {number} priority
 * @property {number} usedInWindow
 * @property {number} remaining
 * @property {boolean} isThrottled
 * @property {boolean} overBurst
 */

/**
 * @typedef {Object} GovernorStatus
 * @property {number} healthyProxyCount
 * @property {number} totalProxyCount
 * @property {number} healthyProxyRatio
 * @property {number} currentReqPerSecond
 * @property {number} redisConsumerLag
 * @property {Array<{accountId: string, remainingSeconds: number, reason: string}>} hibernatingAccounts
 * @property {string} throttleLevel
 * @property {DualPoolStats} dualPool - Dual-pool partition stats (AD-20).
 * @property {Record<string, ConsumerStatus>} consumerQuotas - Per-consumer quota status (AD-20).
 */

/**
 * @typedef {Object} ErrorEnvelope
 * @property {string} code
 * @property {string} type
 * @property {string} message
 * @property {number} statusCode
 * @property {boolean} isRetryable
 * @property {number} retryAfterMs
 * @property {number} retryAfter
 * @property {string} suggestedAction
 * @property {string | null} [accountId]
 * @property {string} [platform]
 * @property {string} [consumerId] - Consumer identity for quota errors (AD-20).
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {Object} ThinEvent
 * @property {string} id - Namespaced id, e.g. "facebook:123" or "threads:abc:456"
 * @property {string} platform - Platform name, e.g. "facebook" | "threads"
 * @property {string} externalId - Platform-native id
 * @property {string} category - Category string, e.g. "social" | "ecom" | "realestate" | "recruitment" | "b2b"
 * @property {string} authorId - Author ID
 * @property {string} crawledAt - ISO 8601 timestamp string
 * @property {string} storageRef - Pointer to the stored row / item id
 */

/**
 * @typedef {Object} StreamMetrics
 * @property {number} eventsPerSecond - New entries per second over the last refresh interval
 * @property {number} pendingMessages - Total entries in the stream (XLEN)
 * @property {number} consumerLag - Unacknowledged / pending messages in consumer group (XPENDING)
 * @property {number} droppedEvents - Cumulative trimmed / dropped events (entries-added - length or best-effort)
 * @property {number} lastAckTime - Seconds since the last consumer ack or idle
 * @property {number} maxLen - Configured MAXLEN / MINID threshold
 * @property {string | null} minId - ID of oldest entry in stream
 */

/**
 * Minimal duck-typed interface matching redis/ioredis clients for stream operations
 * @typedef {Object} RedisClientLike
 * @property {Function} [xAdd]
 * @property {Function} [xadd]
 * @property {Function} [xLen]
 * @property {Function} [xlen]
 * @property {Function} [xInfoStream]
 * @property {Function} [xInfo]
 * @property {Function} [xinfo]
 * @property {Function} [xInfoConsumers]
 * @property {Function} [xGroupCreate]
 * @property {Function} [xgroup]
 * @property {Function} [xPending]
 * @property {Function} [xpending]
 * @property {Function} [sendCommand]
 * @property {boolean | Function} [isOpen]
 * @property {Function} [quit]
 * @property {Function} [disconnect]
 * @property {string} [status]
 */

export const CATEGORIES = Object.freeze({
  SOCIAL: 'social',
  ECOMMERCE: 'ecom',
  REAL_ESTATE: 'realestate',
  RECRUITMENT: 'recruitment',
  // B2B lead data (e.g. LinkedIn company profiles, decision-maker posts).
  // Note: public-procurement B2B (Mua Sắm Công, Mã Số Thuế) is out of scope for Epics 10-18.
  B2B: 'b2b',
});

/** @type {string[]} */
export const CATEGORY_VALUES = Object.values(CATEGORIES);

/**
 * @param {string} platform
 * @param {string} externalId
 * @returns {string}
 */
export function generatePostId(platform, externalId) {
  return `${platform}:${externalId}`;
}

/**
 * @param {string} platform
 * @param {string} postExternalId
 * @param {string} commentExternalId
 * @returns {string}
 */
export function generateCommentId(platform, postExternalId, commentExternalId) {
  return `${platform}:${postExternalId}:${commentExternalId}`;
}

/**
 * @param {string} category
 * @returns {boolean}
 */
export function isValidCategory(category) {
  return CATEGORY_VALUES.includes(category);
}
