// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * StreamAlertEngine — Monitors StreamMetrics and triggers webhooks and emails on threshold breaches.
 * Implements cooldown guards (default 5m) and structured alert payloads.
 * @author nich (@nichxbt)
 * @license MIT
 */

export class StreamAlertEngine {
  /** @type {number} */
  #pendingMessagesThreshold;

  /** @type {number} */
  #consumerLagThreshold;

  /** @type {number} */
  #lastAckTimeThreshold;

  /** @type {number} */
  #cooldownMs;

  /** @type {string | null} */
  #webhookUrl;

  /** @type {string | null} */
  #emailRecipients;

  /** @type {Function | null} */
  #webhookSender;

  /** @type {Function | null} */
  #emailSender;

  /** @type {Map<string, number>} */
  #lastAlertTimes = new Map();

  /** @type {Array<Object>} */
  #alertHistory = [];

  /** @type {string | null} */
  #lastAlertTimestamp = null;

  /**
   * @param {Object} [options]
   * @param {number} [options.pendingMessagesThreshold=50000]
   * @param {number} [options.consumerLagThreshold=50000]
   * @param {number} [options.lastAckTimeThreshold=60]
   * @param {number} [options.cooldownMs=300000]
   * @param {string} [options.webhookUrl]
   * @param {string} [options.emailRecipients]
   * @param {Function} [options.webhookSender]
   * @param {Function} [options.emailSender]
   */
  constructor(options = {}) {
    this.#pendingMessagesThreshold = options.pendingMessagesThreshold ?? 50000;
    this.#consumerLagThreshold = options.consumerLagThreshold ?? 50000;
    this.#lastAckTimeThreshold = options.lastAckTimeThreshold ?? 60;

    const envCooldown = Number(process.env.ALERT_COOLDOWN_MS);
    this.#cooldownMs = options.cooldownMs ?? (Number.isFinite(envCooldown) && envCooldown > 0 ? envCooldown : 300000);

    this.#webhookUrl = options.webhookUrl ?? process.env.ALERT_WEBHOOK ?? null;
    this.#emailRecipients = options.emailRecipients ?? process.env.ALERT_EMAIL ?? null;
    this.#webhookSender = options.webhookSender || null;
    this.#emailSender = options.emailSender || null;
  }

  /**
   * Check metrics against alert rules and trigger notifications if thresholds breached.
   * @param {import('../core/types.js').StreamMetrics} metrics
   * @returns {Promise<{ triggered: boolean, alerts: Array<Object>, suppressedByCooldown?: boolean }>}
   */
  async checkAndAlert(metrics) {
    if (!metrics || typeof metrics !== 'object') {
      return { triggered: false, alerts: [] };
    }

    const now = Date.now();
    const candidateAlerts = [];

    // 1. Pending Messages Threshold (50k)
    if (metrics.pendingMessages > this.#pendingMessagesThreshold) {
      candidateAlerts.push({
        alert: 'redis_stream_lag',
        threshold: this.#pendingMessagesThreshold,
        value: metrics.pendingMessages,
        timestamp: new Date().toISOString(),
        metrics,
      });
    }

    // 2. Consumer Lag Threshold (50k)
    if (metrics.consumerLag > this.#consumerLagThreshold) {
      candidateAlerts.push({
        alert: 'redis_stream_consumer_lag',
        threshold: this.#consumerLagThreshold,
        value: metrics.consumerLag,
        timestamp: new Date().toISOString(),
        metrics,
      });
    }

    // 3. Last Ack Idle Time Threshold (60s)
    if (metrics.lastAckTime > this.#lastAckTimeThreshold) {
      candidateAlerts.push({
        alert: 'redis_stream_ack',
        threshold: this.#lastAckTimeThreshold,
        value: metrics.lastAckTime,
        timestamp: new Date().toISOString(),
        metrics,
      });
    }

    if (candidateAlerts.length === 0) {
      return { triggered: false, alerts: [] };
    }

    // Filter by cooldown
    const actionableAlerts = candidateAlerts.filter((item) => {
      const lastTime = this.#lastAlertTimes.get(item.alert) || 0;
      return now - lastTime >= this.#cooldownMs;
    });

    if (actionableAlerts.length === 0) {
      return { triggered: false, alerts: candidateAlerts, suppressedByCooldown: true };
    }

    for (const alert of actionableAlerts) {
      this.#lastAlertTimes.set(alert.alert, now);
      this.#alertHistory.push(alert);
      if (this.#alertHistory.length > 100) {
        this.#alertHistory.shift();
      }
      this.#lastAlertTimestamp = alert.timestamp;

      await this.#dispatchAlert(alert);
    }

    return { triggered: true, alerts: actionableAlerts };
  }

  /**
   * Dispatch single alert via Webhook and Email.
   * @param {Object} alertPayload
   */
  async #dispatchAlert(alertPayload) {
    // 1. Webhook Dispatch
    const webhookUrl = this.#webhookUrl;
    if (webhookUrl || this.#webhookSender) {
      try {
        if (typeof this.#webhookSender === 'function') {
          await this.#webhookSender(webhookUrl, alertPayload);
        } else if (webhookUrl) {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alertPayload),
          });
        }
      } catch (err) {
        console.warn('[StreamAlertEngine] Failed to deliver webhook alert:', (err instanceof Error ? err.message : String(err)));
      }
    }

    // 2. Email Dispatch
    const emailRecipients = this.#emailRecipients;
    if (emailRecipients || this.#emailSender) {
      try {
        if (typeof this.#emailSender === 'function') {
          await this.#emailSender(emailRecipients, alertPayload);
        } else if (emailRecipients) {
          const { default: nodemailer } = await import('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.ALERT_SMTP_HOST || 'localhost',
            port: Number(process.env.ALERT_SMTP_PORT) || 587,
            secure: process.env.ALERT_SMTP_SECURE === 'true',
            auth: process.env.ALERT_SMTP_USER
              ? {
                  user: process.env.ALERT_SMTP_USER,
                  pass: process.env.ALERT_SMTP_PASS || '',
                }
              : undefined,
          });

          const typedAlert = /** @type {{ alert: string }} */ (alertPayload);
          await transporter.sendMail({
            from: process.env.ALERT_EMAIL_FROM || 'alerts@xactions.app',
            to: emailRecipients,
            subject: `[XActions Alert] ${typedAlert.alert.toUpperCase()} breached threshold`,
            text: JSON.stringify(alertPayload, null, 2),
          });
        }
      } catch (err) {
        console.warn('[StreamAlertEngine] Failed to deliver email alert:', (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  /**
   * Get summary status of stream alerts.
   * @returns {{ activeAlerts: Array<Object>, lastAlertTimestamp: string | null, totalAlertsTriggered: number }}
   */
  getAlertStatus() {
    return {
      activeAlerts: this.#alertHistory.slice(-5),
      lastAlertTimestamp: this.#lastAlertTimestamp,
      totalAlertsTriggered: this.#alertHistory.length,
    };
  }
}

/** @type {StreamAlertEngine} */
export const defaultStreamAlertEngine = new StreamAlertEngine();
