// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

import prisma from '../lib/prisma.js';
/**
 * License Key Management
 * 
 * Generate, validate, and manage license keys for XActions
 */

import crypto from 'crypto';
// Tier codes for key generation
const TIER_CODES = {
  starter: 'STRT',
  business: 'BUSI',
  enterprise: 'ENTR',
};

// Tier features
const TIER_FEATURES = {
  starter: {
    maxUsers: 500,
    maxInstances: 1,
    whiteLabel: false,
    customDomain: true,
    apiAccess: false,
    showBranding: true,
    price: 49,
  },
  business: {
    maxUsers: 5000,
    maxInstances: 3,
    whiteLabel: true,
    customDomain: true,
    apiAccess: true,
    showBranding: false,
    price: 199,
  },
  enterprise: {
    maxUsers: -1, // unlimited
    maxInstances: -1,
    whiteLabel: true,
    customDomain: true,
    apiAccess: true,
    showBranding: false,
    price: 'custom',
  },
};

/**
 * Generate a random segment for license key
 * @param {number} [length]
 * @returns {string}
 */
function generateSegment(length = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  let segment = '';
  for (let i = 0; i < length; i++) {
    segment += chars.charAt(crypto.randomInt(chars.length));
  }
  return segment;
}

/**
 * Generate a new license key
 * Format: XACT-TIER-XXXX-XXXX-SIGN
 * @param {string} tier
 * @returns {string}
 */
function generateLicenseKey(tier) {
  const tierCode = TIER_CODES[/** @type {keyof typeof TIER_CODES} */ (tier)] || 'STRT';
  const segment1 = generateSegment(4);
  const segment2 = generateSegment(4);
  
  // Create signature from tier + segments
  const signature = crypto.createHash('sha256')
    .update(`${tierCode}${segment1}${segment2}${process.env.JWT_SECRET || 'xactions'}`)
    .digest('hex')
    .substring(0, 4)
    .toUpperCase();
  
  return `XACT-${tierCode}-${segment1}-${segment2}-${signature}`;
}

/**
 * Verify license key signature
 * @param {string} key
 * @returns {boolean}
 */
function verifyKeySignature(key) {
  const parts = key.split('-');
  if (parts.length !== 5 || parts[0] !== 'XACT') return false;
  
  const [, tierCode, segment1, segment2, signature] = parts;
  
  const expectedSignature = crypto.createHash('sha256')
    .update(`${tierCode}${segment1}${segment2}${process.env.JWT_SECRET || 'xactions'}`)
    .digest('hex')
    .substring(0, 4)
    .toUpperCase();
  
  return signature === expectedSignature;
}

/**
 * @typedef {object} LicenseCreateOptions
 * @property {string} [tier]
 * @property {string} [customerName]
 * @property {string} [customerEmail]
 * @property {string} [companyName]
 * @property {Date | string} [expiresAt]
 * @property {number} [maxInstances]
 * @property {string} [notes]
 * @property {string} [paymentId]
 * @property {number} [amountPaid]
 */

/**
 * Create a new license in the database
 * @param {Partial<LicenseCreateOptions>} [options]
 */
async function createLicense(options = {}) {
  const tier = typeof options.tier === 'string' ? options.tier : 'starter';
  const customerName = /** @type {string | null | undefined} */ (options.customerName);
  const customerEmail = /** @type {string | null | undefined} */ (options.customerEmail);
  const companyName = /** @type {string | null | undefined} */ (options.companyName);
  const expiresAt = /** @type {Date | string | null | undefined} */ (options.expiresAt);
  const maxInstances = /** @type {number | undefined} */ (options.maxInstances);
  const notes = /** @type {string | null | undefined} */ (options.notes);
  const paymentId = /** @type {string | null | undefined} */ (options.paymentId);
  const amountPaid = typeof options.amountPaid === 'number' ? options.amountPaid : undefined;

  const features = /** @type {Record<string, Record<string, unknown>>} */ (TIER_FEATURES)[tier] || TIER_FEATURES.starter;
  const key = generateLicenseKey(tier);

  const license = await prisma.license.create({
    data: {
      key,
      tier,
      customerName,
      customerEmail,
      companyName,
      maxUsers: Number(features.maxUsers),
      maxInstances: maxInstances !== undefined ? maxInstances : Number(features.maxInstances),
      whiteLabel: Boolean(features.whiteLabel),
      customDomain: Boolean(features.customDomain),
      apiAccess: Boolean(features.apiAccess),
      expiresAt: expiresAt || null,
      paymentId,
      amountPaid,
      notes,
    },
  });

  return license;
}

/**
 * Validate a license key against the database
 * @param {string} key
 */
async function validateLicenseKey(key) {
  // First check format and signature
  if (!key || !verifyKeySignature(key)) {
    return { valid: false, error: 'Invalid license key format' };
  }

  // Check database
  const license = await prisma.license.findUnique({
    where: { key },
  });

  if (!license) {
    return { valid: false, error: 'License key not found' };
  }

  if (license.status === 'revoked') {
    return { valid: false, error: 'License has been revoked' };
  }

  if (license.status === 'suspended') {
    return { valid: false, error: 'License is suspended' };
  }

  if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
    return { valid: false, error: 'License has expired' };
  }

  // License is valid
  return {
    valid: true,
    tier: license.tier,
    features: {
      maxUsers: license.maxUsers,
      maxInstances: license.maxInstances,
      whiteLabel: license.whiteLabel,
      customDomain: license.customDomain,
      apiAccess: license.apiAccess,
      showBranding: !license.whiteLabel,
    },
    expiresAt: license.expiresAt,
    customer: {
      name: license.customerName,
      email: license.customerEmail,
      company: license.companyName,
    },
  };
}

/**
 * Activate a license on an instance
 * @param {string} key
 * @param {string} instanceId
 */
async function activateLicense(key, instanceId) {
  const license = await prisma.license.findUnique({
    where: { key },
  });

  if (!license) {
    return { success: false, error: 'License not found' };
  }

  // Parse existing instance IDs
  let instanceIds = /** @type {string[]} */ ([]);
  try {
    instanceIds = /** @type {string[]} */ (JSON.parse(license.instanceIds || '[]'));
  } catch {
    instanceIds = [];
  }

  // Check if already activated on this instance
  if (instanceIds.includes(instanceId)) {
    return { success: true, message: 'Already activated on this instance' };
  }

  // Check max instances
  if (license.maxInstances !== -1 && instanceIds.length >= license.maxInstances) {
    return { success: false, error: `Maximum instances (${license.maxInstances}) reached` };
  }

  // Add new instance
  instanceIds.push(instanceId);

  await prisma.license.update({
    where: { key },
    data: {
      instanceIds: JSON.stringify(instanceIds),
      activations: license.activations + 1,
      lastActivatedAt: new Date(),
    },
  });

  return { success: true, message: 'License activated successfully' };
}

/**
 * Revoke a license
 * @param {string} key
 * @param {string} reason
 */
async function revokeLicense(key, reason) {
  const license = await prisma.license.update({
    where: { key },
    data: {
      status: 'revoked',
      notes: reason ? `Revoked: ${reason}` : 'Revoked by admin',
    },
  });

  return license;
}

/**
 * @typedef {object} LicenseListOptions
 * @property {string} [status]
 * @property {string} [tier]
 * @property {number} [limit]
 * @property {number} [offset]
 */

/**
 * List all licenses
 * @param {Partial<LicenseListOptions>} [options]
 */
async function listLicenses(options = {}) {
  const status = /** @type {string | undefined} */ (options.status);
  const tier = /** @type {string | undefined} */ (options.tier);
  const limit = typeof options.limit === 'number' ? options.limit : 100;
  const offset = typeof options.offset === 'number' ? options.offset : 0;

  const where = /** @type {{ status?: string; tier?: string }} */ ({});
  if (status) where.status = status;
  if (tier) where.tier = tier;

  const licenses = await prisma.license.findMany({
    where,
    take: limit,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.license.count({ where });

  return { licenses, total };
}

/**
 * Get license by key
 * @param {string} key
 */
async function getLicense(key) {
  return prisma.license.findUnique({
    where: { key },
  });
}

export {
  generateLicenseKey,
  verifyKeySignature,
  createLicense,
  validateLicenseKey,
  activateLicense,
  revokeLicense,
  listLicenses,
  getLicense,
  TIER_FEATURES,
  TIER_CODES,
};
