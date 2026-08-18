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
 * @property {Date} [publishedAt]
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
 * @property {Date} [publishedAt]
 * @property {Date} crawledAt
 */

/**
 * @typedef {Object} LoginResult
 * @property {string} accountId
 * @property {string} cookies
 * @property {Object} tokens
 * @property {Date} [expiresAt]
 */

/**
 * @typedef {Object} CrawlerCommand
 * @property {string} action
 * @property {Object} args
 * @property {Object} [session]
 */

/**
 * @typedef {Object} ActionDescriptor
 * @property {string} action
 * @property {string} description
 * @property {string[]} requiredArgs
 * @property {string[]} [optionalArgs]
 * @property {Object} example
 * @property {string} outputType
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
 * @property {string} [accountId]
 * @property {string} [platform]
 */

export const CATEGORIES = Object.freeze({
  SOCIAL: 'social',
  ECOMMERCE: 'ecom',
  REAL_ESTATE: 'realestate',
  RECRUITMENT: 'recruitment',
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
