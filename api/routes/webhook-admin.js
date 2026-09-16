// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Webhook Admin Routes
 * REST endpoints for outbound webhook subscription management, delivery logs,
 * metrics, and dead-letter queue (DLQ) operations.
 *
 * All routes require admin authentication via `authenticateToken` and `requireAdmin`.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import {
  defaultWebhookSubscriptionStore,
  isValidWebhookUrl,
} from '../../src/streaming/webhook-subscription-store.js';
import {
  defaultWebhookDispatcher,
} from '../../src/streaming/outbound-webhook-dispatcher.js';

/**
 * Factory to create webhook admin router with optional dependency injection.
 *
 * @param {Object} [options]
 * @param {import('../../src/streaming/webhook-subscription-store.js').WebhookSubscriptionStore} [options.subscriptionStore]
 * @param {import('../../src/streaming/outbound-webhook-dispatcher.js').OutboundWebhookDispatcher} [options.dispatcher]
 */

function redactSecret(subscription) {
  if (!subscription || typeof subscription !== 'object') return subscription;
  const { secret, ...rest } = subscription;
  return { ...rest, hasSecret: Boolean(secret) };
}

export function createWebhookAdminRouter(options = {}) {
  const router = Router();
  const store = options.subscriptionStore || defaultWebhookSubscriptionStore;
  const dispatcher = options.dispatcher || defaultWebhookDispatcher;

  // Enforce admin authentication across all endpoints
  router.use(authenticateToken, requireAdmin);

  /**
   * POST /subscriptions
   * Register a new webhook subscription.
   */
  router.post('/subscriptions', async (req, res) => {
    try {
      const body = /** @type {Record<string, any>} */ (req.body || {});
      const { url, events, secret, description, active } = body;

      if (!url || typeof url !== 'string' || !isValidWebhookUrl(url)) {
        return res.status(400).json({ error: 'Invalid webhook URL: must be a valid http or https URL' });
      }

      if (!events || (!Array.isArray(events) && typeof events !== 'string')) {
        return res.status(400).json({ error: 'events must be a non-empty array of platform names or ["*"]' });
      }

      if (Array.isArray(events) && events.length === 0) {
        return res.status(400).json({ error: 'events must be a non-empty array of platform names or ["*"]' });
      }

      const subscription = await store.create({
        url: String(url),
        events: /** @type {string[] | string} */ (events),
        secret: secret !== undefined ? String(secret) : undefined,
        description: description !== undefined ? String(description) : undefined,
        active: active !== undefined ? Boolean(active) : undefined,
      });

      return res.status(201).json(redactSecret(subscription));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Invalid webhook URL') || message.includes('events must be')) {
        return res.status(400).json({ error: message });
      }
      console.error('❌ [WebhookAdmin] Create subscription error:', message);
      return res.status(500).json({ error: 'Failed to create subscription' });
    }
  });

  /**
   * GET /subscriptions
   * List all subscriptions, optionally filtered by active status.
   */
  router.get('/subscriptions', async (req, res) => {
    try {
      const { active } = req.query;
      /** @type {{ active?: boolean }} */
      const filter = {};
      if (active !== undefined) {
        filter.active = active === 'true' || active === '1';
      }

      const subscriptions = await store.list(filter);
      return res.json(subscriptions.map(redactSecret));
    } catch (err) {
      console.error('❌ [WebhookAdmin] List subscriptions error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to list subscriptions' });
    }
  });

  /**
   * GET /subscriptions/:id
   * Get subscription by ID.
   */
  router.get('/subscriptions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const subscription = await store.get(id);

      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const metrics = await dispatcher.getMetrics(id);
      return res.json({ ...redactSecret(subscription), metrics });
    } catch (err) {
      console.error('❌ [WebhookAdmin] Get subscription error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to get subscription' });
    }
  });

  /**
   * PATCH /subscriptions/:id
   * Update subscription fields.
   */
  router.patch('/subscriptions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = /** @type {Record<string, any>} */ (req.body || {});

      if (updates.url !== undefined && !isValidWebhookUrl(String(updates.url))) {
        return res.status(400).json({ error: 'Invalid webhook URL: must be a valid http or https URL' });
      }

      const updated = await store.update(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      return res.json(redactSecret(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Invalid webhook URL') || message.includes('events must be')) {
        return res.status(400).json({ error: message });
      }
      console.error('❌ [WebhookAdmin] Update subscription error:', message);
      return res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  /**
   * DELETE /subscriptions/:id
   * Delete subscription by ID.
   */
  router.delete('/subscriptions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await store.delete(id);

      if (!deleted) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      return res.json({ deleted: true, id });
    } catch (err) {
      console.error('❌ [WebhookAdmin] Delete subscription error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to delete subscription' });
    }
  });

  /**
   * GET /delivery-logs
   * Retrieve recent delivery attempts with status, latency, error.
   */
  router.get('/delivery-logs', async (req, res) => {
    try {
      const { subscriptionId, limit, offset } = req.query;
      const logs = await dispatcher.getDeliveryLogs({
        subscriptionId: typeof subscriptionId === 'string' ? subscriptionId : undefined,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });

      return res.json(logs);
    } catch (err) {
      console.error('❌ [WebhookAdmin] Get delivery logs error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to get delivery logs' });
    }
  });

  /**
   * GET /metrics/:subscriptionId
   * Retrieve metrics for a specific subscription.
   */
  router.get('/metrics/:subscriptionId', async (req, res) => {
    try {
      const { subscriptionId } = req.params;
      const metrics = await dispatcher.getMetrics(subscriptionId);
      return res.json(metrics);
    } catch (err) {
      console.error('❌ [WebhookAdmin] Get metrics error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to get metrics' });
    }
  });

  /**
   * GET /dlq
   * Inspect dead-letter queue (failed deliveries).
   */
  router.get('/dlq', async (req, res) => {
    try {
      const { limit, offset } = req.query;
      const items = await dispatcher.getDlq({
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });

      return res.json(items);
    } catch (err) {
      console.error('❌ [WebhookAdmin] Get DLQ error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to get DLQ' });
    }
  });

  /**
   * POST /dlq/:id/retry
   * Re-attempt delivery of a DLQ entry.
   */
  router.post('/dlq/:id/retry', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await dispatcher.retryDlqEntry(id);

      if (!result.success && result.error === 'DLQ item not found') {
        return res.status(404).json({ error: 'DLQ item not found' });
      }

      if (!result.success && result.error === 'Subscription not found') {
        return res.status(404).json({ error: 'Subscription for this DLQ item no longer exists' });
      }

      return res.json(result);
    } catch (err) {
      console.error('❌ [WebhookAdmin] Retry DLQ error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to retry DLQ entry' });
    }
  });

  /**
   * GET /lag
   * Retrieve consumer group pending messages and lag.
   */
  router.get('/lag', async (_req, res) => {
    try {
      const lagInfo = await dispatcher.getLag();
      return res.json(lagInfo);
    } catch (err) {
      console.error('❌ [WebhookAdmin] Get lag error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Failed to get consumer group lag' });
    }
  });

  return router;
}

const defaultWebhookAdminRouter = createWebhookAdminRouter();
export default defaultWebhookAdminRouter;
