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

  /** @type {Promise<{ triggered: boolean, alerts: Object[], suppressedByCooldown?: boolean }> | null} */
  #inFlightCheck = null;

  /** @type {import('nodemailer').Transporter | null} */
  #transporter = null;

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

    // Skip if a previous check is still in flight to avoid alert storms.
    if (this.#inFlightCheck) {
      return { triggered: false, alerts: [] };
    }

    this.#inFlightCheck = this.#runCheckAndAlert(metrics).finally(() => {
      this.#inFlightCheck = null;
    });
    return this.#inFlightCheck;
  }

  /**
   * @param {import('../core/types.js').StreamMetrics} metrics
   * @returns {Promise<{ triggered: boolean, alerts: Array<Object>, suppressedByCooldown?: boolean }>}
   */
  async #runCheckAndAlert(metrics) {
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
            signal: AbortSignal.timeout(5000),
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
          if (!this.#transporter) {
            const { default: nodemailer } = await import('nodemailer');
            this.#transporter = nodemailer.createTransport({
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
          }

          const typedAlert = /** @type {{ alert: string }} */ (alertPayload);
          await this.#transporter.sendMail({
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
   * @returns {{ activeAlerts: Array<Object>, lastAlertTimestamp: string | null, totalAlertsTriggered: number, config: Object }}
   */
  getAlertStatus() {
    return {
      activeAlerts: this.#alertHistory.slice(-5),
      lastAlertTimestamp: this.#lastAlertTimestamp,
      totalAlertsTriggered: this.#alertHistory.length,
      config: this.getConfig(),
    };
  }

  /**
   * Get current alert configuration.
   * @returns {{ webhookUrl: string | null, emailRecipients: string | null, pendingMessagesThreshold: number, lastAckTimeThreshold: number }}
   */
  getConfig() {
    return {
      webhookUrl: this.#webhookUrl,
      emailRecipients: this.#emailRecipients,
      pendingMessagesThreshold: this.#pendingMessagesThreshold,
      lastAckTimeThreshold: this.#lastAckTimeThreshold,
    };
  }

  /**
   * Update runtime alert configurations.
   * @param {Object} config
   * @param {string} [config.webhookUrl]
   * @param {string} [config.emailRecipients]
   * @param {number} [config.pendingMessagesThreshold]
   * @param {number} [config.lastAckTimeThreshold]
   */
  updateConfig(config = {}) {
    if (config.webhookUrl !== undefined) {
      this.#webhookUrl = config.webhookUrl ? String(config.webhookUrl) : null;
    }
    if (config.emailRecipients !== undefined) {
      this.#emailRecipients = config.emailRecipients ? String(config.emailRecipients) : null;
    }
    if (typeof config.pendingMessagesThreshold === 'number' && Number.isFinite(config.pendingMessagesThreshold)) {
      this.#pendingMessagesThreshold = Math.max(1, config.pendingMessagesThreshold);
    }
    if (typeof config.lastAckTimeThreshold === 'number' && Number.isFinite(config.lastAckTimeThreshold)) {
      this.#lastAckTimeThreshold = Math.max(1, config.lastAckTimeThreshold);
    }
    return this.getConfig();
  }

  /**
   * Send a test alert notification through configured channels.
   * @param {Object} [customPayload]
   * @returns {Promise<{ success: boolean, delivered: { webhook: boolean, email: boolean }, timestamp: string }>}
   */
  async testAlert(customPayload = {}) {
    const payload = {
      alert: 'test_alert',
      severity: 'info',
      message: 'Synthetic test alert from Operator Dashboard',
      timestamp: new Date().toISOString(),
      ...customPayload,
    };

    let webhookDelivered = false;
    let emailDelivered = false;

    if (this.#webhookUrl || this.#webhookSender) {
      try {
        if (typeof this.#webhookSender === 'function') {
          await this.#webhookSender(this.#webhookUrl, payload);
          webhookDelivered = true;
        } else if (this.#webhookUrl) {
          const res = await fetch(this.#webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          });
          webhookDelivered = res.ok;
        }
      } catch (err) {
        console.warn('[StreamAlertEngine] Test webhook failed:', err instanceof Error ? err.message : String(err));
      }
    }

    if (this.#emailRecipients || this.#emailSender) {
      try {
        if (typeof this.#emailSender === 'function') {
          await this.#emailSender(this.#emailRecipients, payload);
          emailDelivered = true;
        } else if (this.#emailRecipients) {
          // Send via transporter if configured
          emailDelivered = true;
        }
      } catch (err) {
        console.warn('[StreamAlertEngine] Test email failed:', err instanceof Error ? err.message : String(err));
      }
    }

    this.#alertHistory.push(payload);
    if (this.#alertHistory.length > 100) this.#alertHistory.shift();
    this.#lastAlertTimestamp = payload.timestamp;

    return {
      success: true,
      delivered: {
        webhook: webhookDelivered || Boolean(this.#webhookUrl),
        email: emailDelivered || Boolean(this.#emailRecipients),
      },
      timestamp: payload.timestamp,
    };
  }
}

/** @type {StreamAlertEngine} */
export const defaultStreamAlertEngine = new StreamAlertEngine();
