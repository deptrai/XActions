// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalization & De-obfuscation utilities for Batdongsan.com.vn
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import zlib from 'node:zlib';
import { validateAndFormatPhone } from '../chotot/normalize-chotot.js';

export const CITY_SLUGS = {
  SG: 'ho-chi-minh',
  HN: 'ha-noi',
  DN: 'da-nang',
  BD: 'binh-duong',
  DDN: 'dong-nai',
  KH: 'khanh-hoa',
  HP: 'hai-phong',
  CT: 'can-tho',
};

export const CATE_CODES = {
  all: 0,
  apartment: 41,
  'can-ho': 41,
  house: 49,
  'nha-rieng': 49,
  villa: 50,
  'biet-thu': 50,
  land: 40,
  'dat-nen': 40,
  office: 51,
};

/**
 * Swap high and low nibbles (4-bit chunks) of each byte (self-inverse).
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function nibbleSwap(buf) {
  if (!Buffer.isBuffer(buf)) {
    buf = Buffer.from(buf || '');
  }
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    out[i] = ((b & 0x0f) << 4) | (b >> 4);
  }
  return out;
}

/**
 * Decode obfuscated p_sync response payload:
 * Gzip (optional) -> Base64 -> Nibble Swap -> UTF-8/Latin-1 JSON.
 * @param {Buffer | Uint8Array | string} rawBuffer
 * @returns {Record<string, any>}
 */
export function decodeBatdongsanPayload(rawBuffer) {
  if (!rawBuffer) return {};
  let data = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

  // Decompress gzip layer if present (magic bytes 0x1F, 0x8B) with 50MB bound
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = zlib.gunzipSync(data, { maxOutputLength: 50 * 1024 * 1024 });
    } catch {
      // Fall back to uncompressed data if gzip fails
    }
  }

  // Base64 decode
  let b64Decoded;
  try {
    b64Decoded = Buffer.from(data.toString('utf8'), 'base64');
  } catch {
    b64Decoded = data;
  }

  // Nibble swap
  const unswapped = nibbleSwap(b64Decoded);

  // Parse JSON (try utf8 then latin1)
  try {
    return JSON.parse(unswapped.toString('utf8'));
  } catch {
    try {
      return JSON.parse(unswapped.toString('latin1'));
    } catch {
      return {};
    }
  }
}

/**
 * Encode fixture payload into p_sync obfuscated format for tests.
 * @param {Record<string, any>} obj
 * @returns {Buffer}
 */
export function encodeBatdongsanPayload(obj) {
  const jsonStr = JSON.stringify(obj || {});
  const swapped = nibbleSwap(Buffer.from(jsonStr, 'utf8'));
  const b64 = swapped.toString('base64');
  return zlib.gzipSync(Buffer.from(b64, 'utf8'));
}

/**
 * Normalize raw Batdongsan product item into standardized PostItem.
 * @param {Record<string, any>} product
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeBatdongsanListing(product = {}) {
  const item = product || {};
  const productId = String(item.ProductId || item.productId || item.id || 'unknown');
  const title = String(item.Title || item.title || '').trim();
  const description = String(item.Description || item.description || '').trim();
  const price = typeof item.PriceCurrent === 'number' ? item.PriceCurrent : (typeof item.price === 'number' ? item.price : null);
  const priceString = String(item.Price || item.priceString || '').trim();
  const priceM2 = String(item.PriceM2 || item.priceM2 || '').trim();

  const size = typeof item.Area === 'number' ? item.Area : (typeof item.size === 'number' ? item.size : null);
  const rooms = typeof item.RoomNumber === 'number' ? item.RoomNumber : null;

  const address = String(item.Address || item.address || '').trim();
  const street = item.Street || '';
  const cityCode = item.CityCode || item.cityCode || '';
  const location = address || `${street} ${cityCode}`.trim();

  const contactName = String(item.ContactName || item.contactName || 'Chủ tin đăng Batdongsan').trim();
  const contactPhone = validateAndFormatPhone(item.ContactPhone || item.contactPhone);

  const images = Array.isArray(item.Images) ? item.Images : (item.Avatar ? [item.Avatar] : []);
  const detailUrl = item.Url || `https://batdongsan.com.vn/ban-dat/${productId}`;

  let publishedAtIso;
  try {
    const parsed = item.StartDate ? new Date(item.StartDate) : new Date();
    publishedAtIso = !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  } catch {
    publishedAtIso = new Date().toISOString();
  }

  return {
    id: `batdongsan:listing:${productId}`,
    platform: 'batdongsan',
    externalId: productId,
    category: 'realestate',
    authorId: `batdongsan:user:${encodeURIComponent(contactName)}`,
    authorName: contactName,
    postUrl: detailUrl,
    content: `${title}\n\nGiá: ${priceString || (price ? `${price.toLocaleString()} đ` : 'Thỏa thuận')} (${priceM2})\nDiện tích: ${size ? `${size} m²` : 'N/A'}\nĐịa điểm: ${location}\n${description}`.trim(),
    mediaUrls: images,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: publishedAtIso,
    crawledAt: new Date(),
    metadata: {
      productId,
      title,
      price,
      priceString,
      priceM2,
      size,
      rooms,
      cityCode,
      address,
      location,
      latitude: item.Latitude || null,
      longitude: item.Longitude || null,
      phone: contactPhone,
      isPhoneVerified: Boolean(contactPhone),
      contactName,
      images,
      sourceMethod: 'search_listings',
    },
  };
}

/**
 * Normalize raw Batdongsan seller into standardized ProfileItem.
 * @param {Record<string, any>} seller
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeBatdongsanSeller(seller = {}) {
  const item = seller || {};
  const contactName = String(item.ContactName || item.contactName || item.name || 'Chủ tin đăng Batdongsan').trim();
  const phone = validateAndFormatPhone(item.ContactPhone || item.contactPhone || item.phone);
  const address = item.Address || item.address || undefined;

  return {
    id: `batdongsan:user:${encodeURIComponent(contactName)}`,
    platform: 'batdongsan',
    externalId: encodeURIComponent(contactName),
    name: contactName,
    username: contactName,
    profileUrl: `https://batdongsan.com.vn/nguoi-ban/${encodeURIComponent(contactName)}`,
    followersCount: 0,
    followingCount: 0,
    crawledAt: new Date(),
    metadata: {
      contactName,
      phone,
      isPhoneVerified: Boolean(phone),
      address,
      sourceMethod: 'seller_profile',
    },
  };
}
