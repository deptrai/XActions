// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Zalo OA schema definitions and parsing utilities.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Generate namespaced Zalo ID.
 * @param {string} externalId
 * @param {string} [prefix]
 * @returns {string}
 */
export function namespacedZaloId(externalId, prefix) {
  if (!externalId) return `zalo:unknown:${Date.now()}`;
  const cleanId = String(externalId).trim();
  return prefix ? `zalo:${prefix}:${cleanId}` : `zalo:${cleanId}`;
}

/**
 * Parse date from Zalo millisecond timestamp, ISO string, or DD/MM/YYYY.
 * @param {unknown} dateVal
 * @returns {Date | null}
 */
export function parseZaloDate(dateVal) {
  if (!dateVal) return null;

  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (!trimmed) return null;

    // Millisecond timestamp as string
    if (/^\d{10,13}$/.test(trimmed)) {
      const ms = parseInt(trimmed, 10);
      const d = new Date(trimmed.length === 10 ? ms * 1000 : ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // DD/MM/YYYY format
    const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const year = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 0;
      const minute = match[5] ? parseInt(match[5], 10) : 0;
      const second = match[6] ? parseInt(match[6], 10) : 0;
      const d = new Date(Date.UTC(year, month, day, hour, minute, second));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Strip basic HTML tags from raw content string.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
