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
    buf = Buffer.from(buf);
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
  let data = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

  // Decompress gzip layer if present (magic bytes 0x1F, 0x8B)
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = zlib.gunzipSync(data);
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
    return JSON.parse(unswapped.toString('latin1'));
  }
}

/**
 * Encode fixture payload into p_sync obfuscated format for tests.
 * @param {Record<string, any>} obj
 * @returns {Buffer}
 */
export function encodeBatdongsanPayload(obj) {
  const jsonStr = JSON.stringify(obj);
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
  const productId = String(product.ProductId || product.productId || product.id || 'unknown');
  const title = String(product.Title || product.title || '').trim();
  const description = String(product.Description || product.description || '').trim();
  const price = typeof product.PriceCurrent === 'number' ? product.PriceCurrent : (typeof product.price === 'number' ? product.price : null);
  const priceString = String(product.Price || product.priceString || '').trim();
  const priceM2 = String(product.PriceM2 || product.priceM2 || '').trim();

  const size = typeof product.Area === 'number' ? product.Area : (typeof product.size === 'number' ? product.size : null);
  const rooms = typeof product.RoomNumber === 'number' ? product.RoomNumber : null;

  const address = String(product.Address || product.address || '').trim();
  const street = product.Street || '';
  const cityCode = product.CityCode || product.cityCode || '';
  const location = address || `${street} ${cityCode}`.trim();

  const contactName = String(product.ContactName || product.contactName || 'Chủ tin đăng Batdongsan').trim();
  const contactPhone = validateAndFormatPhone(product.ContactPhone || product.contactPhone);

  const images = Array.isArray(product.Images) ? product.Images : (product.Avatar ? [product.Avatar] : []);
  const detailUrl = product.Url || `https://batdongsan.com.vn/ban-dat/${productId}`;

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
    publishedAt: product.StartDate ? new Date(product.StartDate).toISOString() : new Date().toISOString(),
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
      latitude: product.Latitude || null,
      longitude: product.Longitude || null,
      phone: contactPhone,
      isPhoneVerified: Boolean(contactPhone),
      contactName,
      images,
      sourceMethod: 'search_listings',
    },
  };
}
