// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared PII redaction helpers for Facebook hybrid social actions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

// eslint-disable-next-line no-use-before-define
const PII_PHONE_RE = /(?<![\w/:])(?:\+?\d[\d\s\-().]{6,}\d)(?![\w/])/g;
const PII_EMAIL_RE = /(^|[^\w/:])[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Strip phone numbers and emails from a string.
 * Phones are fully removed; emails are reduced to the preceding non-word char.
 * The original value should be sent to Facebook unchanged — only redact for logs/previews.
 * @param {string} value
 * @returns {string}
 */
export function stripPii(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(PII_PHONE_RE, '')
    .replace(PII_EMAIL_RE, '$1')
    .trim();
}
