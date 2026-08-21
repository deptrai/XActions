// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Workflow Triggers
 * Event triggers for starting workflow execution
 *
 * Supported trigger types:
 * - schedule/cron: Run on a cron schedule (via Bull queue)
 * - webhook: Run when a webhook is received
 * - manual: Run only when explicitly triggered
 * - event: Run when a specific event occurs (new tweet, follower change)
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { EventEmitter } from 'events';

/**
 * @typedef {import('../types/xactions.js').WorkflowTrigger} WorkflowTrigger
 */

// ============================================================================
// Trigger Manager
// ============================================================================

class TriggerManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Record<string, unknown>>} */
    this._scheduledJobs = new Map(); // workflowId → Bull job reference
    /** @type {Map<string, string>} */
    this._webhookHandlers = new Map(); // webhookId → workflowId
    /** @type {Map<string, Record<string, unknown>>} */
    this._eventWatchers = new Map(); // workflowId → watcher config
    /** @type {import('bull').Queue | null} */
    this._queue = null; // Bull queue reference (set externally)
  }

  /**
   * Set the Bull queue to use for scheduled triggers
   *
   * @param {import('bull').Queue} queue
   */
  setQueue(queue) {
    this._queue = queue;
  }

  /**
   * Register a trigger for a workflow
   *
   * @param {string} workflowId
   * @param {WorkflowTrigger} trigger - { type, cron?, interval?, webhook?, event?, ... }
   * @returns {Promise<Record<string, unknown>>}
   */
  async register(workflowId, trigger) {
    if (!trigger || !trigger.type) {
      throw new Error('Trigger must have a type');
    }

    switch (trigger.type) {
      case 'schedule':
      case 'cron':
        return this._registerSchedule(workflowId, trigger);
      case 'interval':
        return this._registerInterval(workflowId, trigger);
      case 'webhook':
        return this._registerWebhook(workflowId, trigger);
      case 'event':
        return this._registerEvent(workflowId, trigger);
      case 'manual':
        // No setup needed for manual triggers
        return { type: 'manual', workflowId };
      default:
        throw new Error(`Unknown trigger type: ${trigger.type}`);
    }
  }

  /**
   * Unregister all triggers for a workflow
   *
   * @param {string} workflowId
   */
  async unregister(workflowId) {
    // Remove scheduled job
    if (this._scheduledJobs.has(workflowId)) {
      const jobInfo = /** @type {Record<string, unknown>} */ (this._scheduledJobs.get(workflowId));
      const repeatKey = /** @type {string | undefined} */ (jobInfo?.repeatKey);
      if (repeatKey && this._queue) {
        try {
          await this._queue.removeRepeatableByKey(repeatKey);
        } catch {}
      }
      const intervalId = /** @type {NodeJS.Timeout | undefined} */ (jobInfo?.intervalId);
      if (intervalId) {
        clearInterval(intervalId);
      }
      this._scheduledJobs.delete(workflowId);
    }

    // Remove webhook handler
    for (const [webhookId, wfId] of this._webhookHandlers) {
      if (wfId === workflowId) {
        this._webhookHandlers.delete(webhookId);
      }
    }

    // Remove event watcher
    this._eventWatchers.delete(workflowId);
  }

  /**
   * Handle incoming webhook
   *
   * @param {string} webhookId
   * @param {Record<string, unknown>} [payload]
   * @returns {boolean}
   */
  handleWebhook(webhookId, payload = {}) {
    const workflowId = this._webhookHandlers.get(webhookId);
    if (workflowId) {
      this.emit('trigger', {
        workflowId,
        type: 'webhook',
        payload,
        triggeredAt: new Date().toISOString(),
      });
      return true;
    }
    return false;
  }

  /**
   * Get all registered triggers
   *
   * @returns {Record<string, unknown>[]}
   */
  getRegisteredTriggers() {
    const triggers = /** @type {Record<string, unknown>[]} */ ([]);

    for (const [workflowId, jobInfo] of this._scheduledJobs) {
      triggers.push({
        workflowId,
        type: jobInfo.type,
        config: jobInfo.config,
      });
    }

    for (const [webhookId, workflowId] of this._webhookHandlers) {
      triggers.push({
        workflowId,
        type: 'webhook',
        webhookId,
      });
    }

    for (const [workflowId, config] of this._eventWatchers) {
      triggers.push({
        workflowId,
        type: 'event',
        config,
      });
    }

    return triggers;
  }

  // --------------------------------------------------------------------------
  // Private: Schedule (cron)
  // --------------------------------------------------------------------------

  /**
   * @param {string} workflowId
   * @param {WorkflowTrigger} trigger
   * @returns {Promise<Record<string, unknown>>}
   */
  async _registerSchedule(workflowId, trigger) {
    if (!trigger.cron) {
      throw new Error('Schedule trigger requires a "cron" field');
    }

    if (this._queue) {
      // Use Bull repeatable job
      const job = await this._queue.add(
        'workflowTrigger',
        { workflowId, triggerType: 'schedule' },
        {
          repeat: { cron: trigger.cron },
          jobId: `workflow-schedule-${workflowId}`,
        }
      );

      this._scheduledJobs.set(workflowId, {
        type: 'schedule',
        config: { cron: trigger.cron },
        repeatKey: job.opts.repeat?.key,
      });
    } else {
      // Fallback: use cron-like interval parsing
      console.warn(`⚠️ No Bull queue available, schedule trigger for ${workflowId} is inactive`);
      this._scheduledJobs.set(workflowId, {
        type: 'schedule',
        config: { cron: trigger.cron },
        inactive: true,
      });
    }

    return { type: 'schedule', workflowId, cron: trigger.cron };
  }

  // --------------------------------------------------------------------------
  // Private: Interval
  // --------------------------------------------------------------------------

  /**
   * @param {string} workflowId
   * @param {WorkflowTrigger} trigger
   * @returns {Promise<Record<string, unknown>>}
   */
  async _registerInterval(workflowId, trigger) {
    const intervalMs = trigger.interval || 60000;

    const intervalId = setInterval(() => {
      this.emit('trigger', {
        workflowId,
        type: 'interval',
        triggeredAt: new Date().toISOString(),
      });
    }, intervalMs);

    this._scheduledJobs.set(workflowId, {
      type: 'interval',
      config: { interval: intervalMs },
      intervalId,
    });

    return { type: 'interval', workflowId, interval: intervalMs };
  }

  // --------------------------------------------------------------------------
  // Private: Webhook
  // --------------------------------------------------------------------------

  /**
   * @param {string} workflowId
   * @param {WorkflowTrigger} trigger
   * @returns {Promise<Record<string, unknown>>}
   */
  async _registerWebhook(workflowId, trigger) {
    // Generate a unique webhook ID
    const webhookId = trigger.webhookId || `wh-${workflowId}-${Date.now().toString(36)}`;
    this._webhookHandlers.set(webhookId, workflowId);

    return {
      type: 'webhook',
      workflowId,
      webhookId,
      url: `/api/workflows/webhook/${webhookId}`,
    };
  }

  // --------------------------------------------------------------------------
  // Private: Event
  // --------------------------------------------------------------------------

  /**
   * @param {string} workflowId
   * @param {WorkflowTrigger} trigger
   * @returns {Promise<Record<string, unknown>>}
   */
  async _registerEvent(workflowId, trigger) {
    if (!trigger.event) {
      throw new Error('Event trigger requires an "event" field');
    }

    this._eventWatchers.set(workflowId, {
      event: trigger.event,
      target: trigger.target,
      threshold: trigger.threshold,
    });

    return { type: 'event', workflowId, event: trigger.event };
  }

  /**
   * Cleanup all triggers
   */
  async shutdown() {
    for (const [workflowId] of this._scheduledJobs) {
      await this.unregister(workflowId);
    }
    this._webhookHandlers.clear();
    this._eventWatchers.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
const triggerManager = new TriggerManager();

export { TriggerManager };
export default triggerManager;
