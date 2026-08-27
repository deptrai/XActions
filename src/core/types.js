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
 * @property {string} [authorAvatar]
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
 * @property {string} [authorAvatar]
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
 * @property {string} [description]
 * @property {string[]} [requiredArgs]
 * @property {string[]} [optionalArgs]
 * @property {Object} [example]
 * @property {string} [outputType]
 * @property {boolean} [requiresAuth]
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
