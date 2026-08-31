// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalization utilities, category mappings and RSA encryption for Chợ Tốt data
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import crypto from 'node:crypto';

export const CHOTOT_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAxnvPjlA/K/adq6mA6+uU
tlyBBxFaKeK+WD2FypOeCAP0qtucmaDrIbxirykrxQjRpGxl2HKRBwGd2h/hDuk9
CxRUXD2p0Hrzb1Hb9M5px19TPXM6AWSClR1kozehRusIFrxP6PHqDLx5prJFLlSZ
zg3N3oGhS6oP/a4Ku/iAdCUCiHb5TX3b3+y4Ll/QViZhpKZjU6BhIOsiVIJhyXvn
0cSqLXPjNuXR5A4JkmRl9T9cWncEHTKmoVUyXQJaDZa3yH/OJSEmhhGyKNKkM5so
lasJWSBKenFnFvphw3+KG8BGfJwGkvtRAVbS1ljduH8z8fxALxHgUdnTtgpxB+KZ
/CVnNr97EGqYPLVlX+duGkuy1yCunqVTiY2HyL/0bMTBK84oCQjtMVAHgZ345hZn
mGST71D8+i5HGtOOFoRyP6qK6ex1qfEROzWsmVDA00aHLlQcKOLaHvT/DB30aeUs
ZoL/kQo100XccufpHESrits0mEuoyza4CCFM04F3pDOXAgMBAAE=
-----END PUBLIC KEY-----`;

export const CATEGORY_CONFIG = {
  bds: {
    cg: 1000,
    detail_origin: 'https://www.nhatot.com',
    supported_listing_types: { sell: 's', rent: 'u', want_to_buy: 's' },
    default_listing_type: 'sell',
  },
  cars: {
    cg: 2010,
    detail_origin: 'https://xe.chotot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
  motorbikes: {
    cg: 2020,
    detail_origin: 'https://xe.chotot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
  electronics: {
    cg: 5000,
    detail_origin: 'https://www.chotot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
  pets: {
    cg: 12000,
    detail_origin: 'https://www.chotot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
  fashion: {
    cg: 3000,
    detail_origin: 'https://www.chotot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
  home_goods: {
    cg: 8000,
    detail_origin: 'https://www.chotot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
  jobs: {
    cg: 13000,
    detail_origin: 'https://vieclamtot.com',
    supported_listing_types: { sell: 's' },
    default_listing_type: 'sell',
  },
};

export const PROPERTY_TYPE_CG_MAP = {
  apartment: 1010,
  house: 1020,
  office: 1030,
  land: 1040,
};

/**
 * Get category configuration by slug or cg number
 * @param {string|number} category
 * @returns {Record<string, any>}
 */
export function getCategoryConfig(category) {
  const catStr = String(category || 'bds').trim().toLowerCase();
  if (CATEGORY_CONFIG[catStr]) {
    return CATEGORY_CONFIG[catStr];
  }
  if (/^\d+$/.test(catStr)) {
    return {
      cg: Number(catStr),
      detail_origin: 'https://www.chotot.com',
      supported_listing_types: { sell: 's' },
      default_listing_type: 'sell',
    };
  }
  return CATEGORY_CONFIG.bds;
}

/**
 * Encrypt list_id with Chợ Tốt RSA public key
 * @param {number|string} listId
 * @returns {string} Base64 encoded token
 */
export function encryptChototListId(listId) {
  if (!listId) return '';
  const buffer = Buffer.from(String(listId));
  const encrypted = crypto.publicEncrypt(
    {
      key: CHOTOT_RSA_PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return encrypted.toString('base64');
}

/**
 * Validate and normalize Vietnamese phone numbers, detecting masked ones.
 * @param {string} rawPhone
 * @returns {string | null}
 */
export function validateAndFormatPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const trimmed = rawPhone.trim();

  // If phone contains mask characters, reject
  if (trimmed.includes('*') || trimmed.includes('x') || trimmed.includes('X')) {
    return null;
  }

  // Standardize prefix +84 -> 0
  let cleaned = trimmed.replace(/[\s.-]/g, '');
  if (cleaned.startsWith('+84')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('84') && cleaned.length === 11) {
    cleaned = '0' + cleaned.slice(2);
  }

  // Vietnamese 10-digit mobile number regex:
  // Viettel: 032-039, 086, 096-098
  // Mobifone: 070-079, 089, 090, 093
  // Vinaphone: 081-085, 088, 091, 094
  // Vietnamobile: 052, 056, 058, 092
  // Gmobile / Itelecom / Wintel: 059, 087, 055
  const vnPhoneRegex = /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;
  if (vnPhoneRegex.test(cleaned)) {
    return cleaned;
  }

  return null;
}

/**
 * Normalize raw Chợ Tốt ad listing into PostItem.
 * @param {Record<string, any>} ad
 * @param {string} [categorySlug='bds']
 * @param {string | null} [phone=null]
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeChototListing(ad = {}, categorySlug = 'bds', phone = null) {
  const listId = String(ad.list_id || ad.id || 'unknown');
  const title = String(ad.subject || ad.title || '').trim();
  const body = String(ad.body || ad.description || '').trim();
  const cfg = getCategoryConfig(categorySlug);

  const price = typeof ad.price === 'number' ? ad.price : null;
  const priceString = String(ad.price_string || '').trim();
  const size = typeof ad.size === 'number' ? ad.size : null;
  const rooms = typeof ad.rooms === 'number' ? ad.rooms : null;

  const region = ad.region_name || '';
  const regionId = ad.region_v2 || null;
  const area = ad.area_name || '';
  const areaId = ad.area_v2 || null;
  const location = area && region ? `${area}, ${region}` : (area || region || '');

  const sellerName = String(ad.account_name || 'Người đăng Chợ Tốt').trim();
  const sellerOid = String(ad.account_oid || 'unknown');

  const images = Array.isArray(ad.images) ? ad.images : [];
  const validatedPhone = validateAndFormatPhone(phone || ad.phone);

  const detailUrl = `${cfg.detail_origin}/${listId}.htm`;

  return {
    id: `chotot:ad:${listId}`,
    platform: 'chotot',
    externalId: listId,
    category: categorySlug === 'bds' ? 'realestate' : 'ecom',
    authorId: `chotot:account:${sellerOid}`,
    authorName: sellerName,
    postUrl: detailUrl,
    content: `${title}\n\nGiá: ${priceString || (price ? `${price.toLocaleString()} đ` : 'Thỏa thuận')}\nĐịa điểm: ${location}\n${body}`.trim(),
    mediaUrls: images,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: ad.list_time ? new Date(ad.list_time).toISOString() : new Date().toISOString(),
    crawledAt: new Date(),
    metadata: {
      listId,
      title,
      category: categorySlug,
      categoryGroup: ad.cg,
      price,
      priceString,
      size,
      rooms,
      region,
      regionId,
      area,
      areaId,
      location,
      phone: validatedPhone,
      isPhoneVerified: Boolean(validatedPhone),
      sellerName,
      sellerOid,
      images,
      sourceMethod: 'search_listings',
    },
  };
}
