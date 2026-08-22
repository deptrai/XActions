// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

import prisma from '../lib/prisma.js';
/**
 * Stripe Billing Service
 * Handles customer creation, subscriptions, and portal sessions.
 *
 * @author nichxbt
 */

import Stripe from 'stripe';
import { TIERS } from '../config/subscription-tiers.js';
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Get or create a Stripe customer for a user
 * @param {Record<string, unknown>} user
 */
export async function getOrCreateCustomer(user) {
  const stripe = getStripe();

  // Check if user already has a subscription with a Stripe customer ID
  const existing = await prisma.subscription.findUnique({
    where: { userId: String(user.id) },
  });

  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email: String(user.email),
    metadata: {
      userId: String(user.id),
      username: String(user.username || ''),
    },
  });

  // Upsert subscription record with customer ID
  await prisma.subscription.upsert({
    where: { userId: String(user.id) },
    create: {
      userId: String(user.id),
      tier: 'free',
      status: 'active',
      stripeCustomerId: customer.id,
      startDate: new Date(),
    },
    update: {
      stripeCustomerId: customer.id,
    },
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout session for a subscription
 * @param {Record<string, unknown>} user
 * @param {string} tier
 */
export async function createCheckoutSession(user, tier) {
  const stripe = getStripe();
  const tierConfig = /** @type {Record<string, unknown>} */ (TIERS[tier]);

  if (!tierConfig || !tierConfig.stripePriceId) {
    throw new Error(`Invalid or unconfigured tier: ${tier}`);
  }

  const customerId = await getOrCreateCustomer(user);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: String(tierConfig.stripePriceId),
        quantity: 1,
      },
    ],
    success_url: `${process.env.API_URL || 'http://localhost:3001'}/billing?success=true`,
    cancel_url: `${process.env.API_URL || 'http://localhost:3001'}/billing?canceled=true`,
    metadata: {
      userId: String(user.id),
      tier,
    },
  });

  return session;
}

/**
 * Create a Stripe Customer Portal session (manage billing, cancel, update card)
 * @param {Record<string, unknown>} user
 */
export async function createPortalSession(user) {
  const stripe = getStripe();
  const customerId = await getOrCreateCustomer(user);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.API_URL || 'http://localhost:3001'}/billing`,
  });

  return session;
}

/**
 * Get current subscription status for a user
 * @param {string} userId
 */
export async function getSubscriptionStatus(userId) {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription) {
    return { tier: 'free', status: 'active', limits: TIERS.free.limits, features: TIERS.free.features };
  }

  const tierConfig = TIERS[subscription.tier] || TIERS.free;

  return {
    tier: subscription.tier,
    status: subscription.status,
    currentPeriodEnd: subscription.endDate,
    cancelAt: subscription.cancelAt,
    limits: tierConfig.limits,
    features: tierConfig.features,
  };
}

/**
 * Cancel a subscription (at period end)
 * @param {string} userId
 */
export async function cancelSubscription(userId) {
  const stripe = getStripe();

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No active subscription found');
  }

  // Cancel at end of billing period, not immediately
  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await prisma.subscription.update({
    where: { userId },
    data: {
      cancelAt: new Date(updated.current_period_end * 1000),
    },
  });

  return { cancelAt: new Date(updated.current_period_end * 1000) };
}

/**
 * Handle Stripe webhook events — called from the webhook route
 * @param {import('stripe').Stripe.Event} event
 */
export async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event.data.object));
      if (session.mode === 'subscription') {
        await activateSubscription(session);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event.data.object));
      await syncSubscription(sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event.data.object));
      await deactivateSubscription(sub);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event.data.object));
      await recordPayment(invoice);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event.data.object));
      await handleFailedPayment(invoice);
      break;
    }

    default:
      // Unhandled event type — no action needed
      break;
  }
}

// --- Internal helpers ---

/**
 * @param {Record<string, unknown>} session
 */
async function activateSubscription(session) {
  const metadata = /** @type {Record<string, unknown>} */ (session.metadata || {});
  const userId = String(metadata.userId);
  const tier = String(metadata.tier);
  if (!userId || !tier) return;

  const tierConfig = /** @type {Record<string, unknown>} */ (TIERS[tier] || {});

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      tier,
      status: 'active',
      stripeCustomerId: session.customer ? String(session.customer) : null,
      stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
      stripePriceId: tierConfig.stripePriceId ? String(tierConfig.stripePriceId) : null,
      startDate: new Date(),
    },
    update: {
      tier,
      status: 'active',
      stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
      stripePriceId: tierConfig.stripePriceId ? String(tierConfig.stripePriceId) : null,
      cancelAt: null,
    },
  });

  console.log(`✅ Subscription activated: user=${userId} tier=${tier}`);
}

/**
 * @param {Record<string, unknown>} stripeSubscription
 */
async function syncSubscription(stripeSubscription) {
  const sub = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: String(stripeSubscription.id) },
  });

  if (!sub) return;

  const status = stripeSubscription.cancel_at_period_end
    ? 'cancelled'
    : mapStripeStatus(String(stripeSubscription.status));

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status,
      endDate: new Date(Number(stripeSubscription.current_period_end) * 1000),
      cancelAt: stripeSubscription.cancel_at
        ? new Date(Number(stripeSubscription.cancel_at) * 1000)
        : null,
    },
  });
}

/**
 * @param {Record<string, unknown>} stripeSubscription
 */
async function deactivateSubscription(stripeSubscription) {
  const sub = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: String(stripeSubscription.id) },
  });

  if (!sub) return;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      tier: 'free',
      status: 'expired',
      stripeSubscriptionId: null,
      stripePriceId: null,
      endDate: new Date(),
    },
  });

  console.log(`⚠️ Subscription deactivated: user=${sub.userId}`);
}

/**
 * @param {Record<string, unknown>} invoice
 */
async function recordPayment(invoice) {
  if (!invoice.customer) return;

  const sub = await prisma.subscription.findUnique({
    where: { stripeCustomerId: String(invoice.customer) },
  });

  if (!sub) return;

  await prisma.payment.create({
    data: {
      userId: sub.userId,
      type: 'subscription',
      amount: Number(invoice.amount_paid) / 100,
      currency: String(invoice.currency),
      stripePaymentId: invoice.payment_intent ? String(invoice.payment_intent) : null,
      stripeInvoiceId: String(invoice.id),
      status: 'succeeded',
    },
  });
}

/**
 * @param {Record<string, unknown>} invoice
 */
async function handleFailedPayment(invoice) {
  if (!invoice.customer) return;

  const sub = await prisma.subscription.findUnique({
    where: { stripeCustomerId: String(invoice.customer) },
  });

  if (!sub) return;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'past_due' },
  });

  await prisma.payment.create({
    data: {
      userId: sub.userId,
      type: 'subscription',
      amount: Number(invoice.amount_due) / 100,
      currency: String(invoice.currency),
      stripePaymentId: invoice.payment_intent ? String(invoice.payment_intent) : null,
      stripeInvoiceId: String(invoice.id),
      status: 'failed',
    },
  });

  console.log(`❌ Payment failed for user ${sub.userId}`);
}

/**
 * Map Stripe subscription status to internal XActions status.
 * @param {string} status
 * @returns {string}
 */
function mapStripeStatus(status) {
  const mapping = /** @type {Record<string, string>} */ ({
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'unpaid',
    incomplete: 'incomplete',
    incomplete_expired: 'expired',
    trialing: 'active',
  });
  return mapping[status] || status;
}
