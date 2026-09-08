// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AlertDispatcher — Outbound alerting and deduplication for scraper benchmark degradation (Story 34.8 / AD-27).
 * Dispatches operator alerts via Telegram, Slack, or generic webhooks when scrapers drop to Tier C.
 * Enforces 1-hour deduplication window per scraper and supports alert inspection.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import crypto from 'node:crypto';

export class AlertDispatcher {
  /** @type {Map<string, number>} scraperId -> lastAlertTimestamp */
  #lastAlertByScraper = new Map();

  /** @type {Array<Record<string, any>>} */
  #alertHistory = [];

  /** @type {number} */
  #dedupWindowMs;

  /** @type {Function | null} */
  #dispatchSeam = null;

  /**
   * @param {Object} [options]
   * @param {number} [options.dedupWindowMs=3600000] 1 hour default
   * @param {Function} [options.dispatchSeam] Custom dispatcher seam for unit testing
   */
  constructor(options = {}) {
    this.#dedupWindowMs = options.dedupWindowMs || 3600000;
    this.#dispatchSeam = options.dispatchSeam || null;
  }

  /**
   * Check if outbound alerts are globally enabled.
   * @returns {boolean}
   */
  isEnabled() {
    return process.env.BENCHMARK_ALERTS !== 'false';
  }

  /**
   * Send notification to Telegram bot.
   * @param {Record<string, any>} payload
   * @returns {Promise<boolean>}
   */
  async #sendTelegram(payload) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return false;

    const text =
      `🚨 *[XActions Benchmark Alert]* 🚨\n\n` +
      `*Scraper:* \`${payload.scraper_id}\` (${payload.platform})\n` +
      `*Tier:* ${payload.previous_tier} ➔ *${payload.current_tier}*\n` +
      `*Health Score:* ${payload.health_score?.toFixed(1) ?? 'N/A'}/100\n` +
      `*Reason:* ${payload.reason}\n` +
      `*Action Required:* ${payload.action}\n` +
      `*Time:* ${payload.evaluated_at}`;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });
      return res.ok;
    } catch (err) {
      console.warn('[AlertDispatcher] Telegram dispatch error:', err.message);
      return false;
    }
  }

  /**
   * Send notification to Slack incoming webhook.
   * @param {Record<string, any>} payload
   * @returns {Promise<boolean>}
   */
  async #sendSlack(payload) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return false;

    const body = {
      text: `🚨 *[XActions Benchmark Alert]*: Scraper \`${payload.scraper_id}\` degraded to Tier ${payload.current_tier} (${payload.reason})`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🚨 Scraper Health Degradation Alert' },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Scraper:* ${payload.scraper_id}` },
            { type: 'mrkdwn', text: `*Platform:* ${payload.platform}` },
            { type: 'mrkdwn', text: `*Current Tier:* *${payload.current_tier}*` },
            { type: 'mrkdwn', text: `*Health Score:* ${payload.health_score?.toFixed(1) ?? 'N/A'}` },
            { type: 'mrkdwn', text: `*Reason:* ${payload.reason}` },
            { type: 'mrkdwn', text: `*Action:* ${payload.action}` },
          ],
        },
      ],
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch (err) {
      console.warn('[AlertDispatcher] Slack dispatch error:', err.message);
      return false;
    }
  }

  /**
   * Send notification to generic webhook URL.
   * @param {Record<string, any>} payload
   * @returns {Promise<boolean>}
   */
  async #sendWebhook(payload) {
    const webhookUrl = process.env.BENCHMARK_WEBHOOK_URL;
    if (!webhookUrl) return false;

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (err) {
      console.warn('[AlertDispatcher] Webhook dispatch error:', err.message);
      return false;
    }
  }

  /**
   * Dispatch an alert for a degraded scraper.
   * Enforces 1-hour deduplication window per scraper.
   *
   * @param {Object} alertData
   * @param {string} alertData.scraperId
   * @param {string} alertData.platform
   * @param {'A' | 'B' | 'C' | 'UNKNOWN'} [alertData.previousTier='UNKNOWN']
   * @param {'C'} [alertData.currentTier='C']
   * @param {number} alertData.healthScore
   * @param {string} [alertData.reason]
   * @param {Date | string} [alertData.evaluatedAt]
   * @returns {Promise<{
   *   alert: Record<string, any>;
   *   dispatched: boolean;
   *   deduped: boolean;
   *   channels: string[];
   * }>}
   */
  async dispatchAlert(alertData) {
    const scraperId = alertData.scraperId;
    const now = Date.now();
    const lastSent = this.#lastAlertByScraper.get(scraperId);

    const isDeduped = lastSent !== undefined && now - lastSent < this.#dedupWindowMs;

    const alert = {
      alert_id: crypto.randomUUID(),
      scraper_id: scraperId,
      platform: alertData.platform || 'unknown',
      previous_tier: alertData.previousTier || 'UNKNOWN',
      current_tier: alertData.currentTier || 'C',
      health_score: typeof alertData.healthScore === 'number' ? Number(alertData.healthScore.toFixed(1)) : 0,
      reason: alertData.reason || 'Health score degraded to Tier C',
      evaluated_at: alertData.evaluatedAt
        ? new Date(alertData.evaluatedAt).toISOString()
        : new Date().toISOString(),
      action: 'manual_review_required',
      deduped: isDeduped,
    };

    this.#alertHistory.unshift(alert);
    if (this.#alertHistory.length > 100) {
      this.#alertHistory.pop();
    }

    if (isDeduped || !this.isEnabled()) {
      return {
        alert,
        dispatched: false,
        deduped: isDeduped,
        channels: [],
      };
    }

    this.#lastAlertByScraper.set(scraperId, now);

    if (this.#dispatchSeam) {
      await this.#dispatchSeam(alert);
      return {
        alert,
        dispatched: true,
        deduped: false,
        channels: ['custom_seam'],
      };
    }

    const channels = [];
    const [telegramSent, slackSent, webhookSent] = await Promise.all([
      this.#sendTelegram(alert),
      this.#sendSlack(alert),
      this.#sendWebhook(alert),
    ]);

    if (telegramSent) channels.push('telegram');
    if (slackSent) channels.push('slack');
    if (webhookSent) channels.push('webhook');

    return {
      alert,
      dispatched: channels.length > 0,
      deduped: false,
      channels,
    };
  }

  /**
   * Retrieve recent alerts.
   * @param {Object} [options]
   * @param {number} [options.limit=20]
   * @returns {Array<Record<string, any>>}
   */
  getAlerts(options = {}) {
    const limit = options.limit || 20;
    return this.#alertHistory.slice(0, limit);
  }

  /**
   * Clear history and deduplication caches (useful in tests).
   */
  clear() {
    this.#lastAlertByScraper.clear();
    this.#alertHistory = [];
  }
}

export const defaultAlertDispatcher = new AlertDispatcher();
