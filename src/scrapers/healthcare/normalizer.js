// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare, Clinics & Pharmacy HTML/JSON → PostItem normalizer.
 * Supports Medpro, YouMed, and Long Chau.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../core/types.js';
import { parseVnPhone } from './schema.js';

const TAG_RE = /<[^>]+>/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/&(#?x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[entity] ?? m;
  });
}

function stripTags(html) {
  if (typeof html !== 'string') return '';
  return decodeEntities(html.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim());
}

function buildPostItem(input) {
  const {
    platform,
    externalId,
    title = '',
    contentParts = [],
    authorId = '',
    authorName = '',
    postUrl = '',
    mediaUrls = [],
    publishedAt = null,
    metadata = {},
  } = input;

  const resolvedTitle = title || metadata.facilityName || metadata.doctorName || externalId;

  return {
    id: generatePostId(platform, externalId),
    platform,
    externalId,
    title: resolvedTitle,
    category: 'healthcare',
    authorId,
    authorName,
    postUrl,
    content: contentParts.filter(Boolean).join(' - ') || resolvedTitle,
    mediaUrls,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt,
    crawledAt: new Date(),
    metadata,
  };
}

// ── Medpro ─────────────────────────────────────────────────────────────────

function extractMedproItems(html, sourcePlatform = 'medpro') {
  const items = [];
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return items;

  try {
    const data = JSON.parse(m[1]);
    const initHospitals = data.props?.pageProps?.initialHospitals;
    if (!initHospitals || typeof initHospitals !== 'object') return items;

    const list = Object.values(initHospitals);
    for (const h of list) {
      if (!h || typeof h !== 'object') continue;
      const externalId = String(h.partnerId || h._id || '');
      if (!externalId) continue;

      const name = stripTags(h.name || '');
      const cityName = stripTags(h.city?.name || '');
      const types = Array.isArray(h.newHospitalTypes) ? h.newHospitalTypes : [];
      const businessType = types.includes(1) ? 'hospital' : 'clinic';
      const detailUrl = externalId ? `https://medpro.vn/co-so-y-te/${externalId}` : '';
      const address = stripTags(h.address || h.location || '');
      const { phone, phoneMasked } = parseVnPhone(h.phone || h.hotline || h.telephone);

      items.push(buildPostItem({
        platform: 'medpro',
        externalId,
        title: name,
        contentParts: [name, cityName, address].filter(Boolean),
        authorId: phone || `medpro:${externalId}`,
        authorName: 'Medpro',
        postUrl: detailUrl,
        mediaUrls: h.avatar ? [h.avatar] : [],
        metadata: {
          facilityName: name,
          doctorName: null,
          specialty: null,
          businessType,
          hotline: phone,
          phone,
          phoneMasked,
          address,
          city: cityName,
          district: stripTags(h.district?.name || ''),
          gpsLat: typeof h.lat === 'number' ? h.lat : null,
          gpsLng: typeof h.lng === 'number' ? h.lng : null,
          operationHours: h.workingHours || null,
          license: null,
          pharmacist: null,
          detailUrl,
          sourcePlatform,
        },
      }));
    }
  } catch {
    // skip JSON parse errors
  }

  return items;
}

function extractMedproDetail(html, sourcePlatform = 'medpro') {
  const listingItems = extractMedproItems(html, sourcePlatform);
  if (listingItems.length > 0) return listingItems.slice(0, 1);

  // Parse standalone facility detail page
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<|]+)/i);
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : '';
  if (!title) return [];

  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const detailUrl = canonicalMatch ? canonicalMatch[1] : '';
  const externalId = detailUrl ? detailUrl.split('/').pop() || 'medpro-detail' : 'medpro-detail';

  const addressMatch = html.match(/class=["'][^"']*address[^"']*["'][^>]*>([^<]+)/i);
  const address = addressMatch ? stripTags(addressMatch[1]).trim() : '';
  const phoneMatch = html.match(/(?:hotline|điện thoại|tel)[\s:]*([0-9\s.-]{8,15})/i);
  const { phone, phoneMasked } = parseVnPhone(phoneMatch ? phoneMatch[1] : null);

  return [buildPostItem({
    platform: 'medpro',
    externalId,
    title,
    contentParts: [title, address].filter(Boolean),
    authorId: phone || `medpro:${externalId}`,
    authorName: 'Medpro',
    postUrl: detailUrl,
    mediaUrls: [],
    metadata: {
      facilityName: title,
      doctorName: null,
      specialty: null,
      businessType: 'facility',
      hotline: phone,
      phone,
      phoneMasked,
      address,
      city: '',
      district: '',
      gpsLat: null,
      gpsLng: null,
      operationHours: null,
      license: null,
      pharmacist: null,
      detailUrl,
      sourcePlatform,
    },
  })];
}

// ── Long Chau ──────────────────────────────────────────────────────────────

function extractLongChauItems(html, sourcePlatform = 'nhathuoclongchau') {
  const items = [];
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return items;

  try {
    const data = JSON.parse(m[1]);
    const recommended = data.props?.pageProps?.initialPharmacyRecommended;
    const storeList = Array.isArray(recommended?.items) ? recommended.items : [];

    for (const s of storeList) {
      if (!s || typeof s !== 'object') continue;
      const externalId = String(s.shopCode || s.placeId || '');
      if (!externalId) continue;

      const name = stripTags(s.shopNameDisplay || s.shopName || '');
      const address = stripTags(s.location?.address || s.location?.addressDisplay || '');
      const { phone, phoneMasked } = parseVnPhone(s.phone);
      const lat = parseFloat(s.location?.coordinates?.latitude);
      const lng = parseFloat(s.location?.coordinates?.longitude);
      const detailUrl = s.slugEcom ? `https://nhathuoclongchau.com.vn/${s.slugEcom}` : '';

      items.push(buildPostItem({
        platform: 'nhathuoclongchau',
        externalId,
        title: name,
        contentParts: [name, address].filter(Boolean),
        authorId: phone || `longchau:${externalId}`,
        authorName: 'Long Châu',
        postUrl: detailUrl,
        mediaUrls: Array.isArray(s.pictures) ? s.pictures : [],
        metadata: {
          facilityName: name,
          doctorName: null,
          specialty: null,
          businessType: 'pharmacy',
          hotline: phone,
          phone,
          phoneMasked,
          address,
          city: stripTags(s.provinceName || ''),
          district: stripTags(s.districtName || s.wardName || ''),
          ward: stripTags(s.wardName || ''),
          gpsLat: Number.isFinite(lat) ? lat : null,
          gpsLng: Number.isFinite(lng) ? lng : null,
          operationHours: s.operation || null,
          license: s.pharmacyLicenseData || null,
          pharmacist: s.responsiblePharmacist || null,
          detailUrl,
          sourcePlatform,
        },
      }));
    }
  } catch {
    // skip parse errors
  }

  return items;
}

function extractLongChauDetail(html, sourcePlatform = 'nhathuoclongchau') {
  const items = extractLongChauItems(html, sourcePlatform);
  return items.slice(0, 1);
}

// ── YouMed ─────────────────────────────────────────────────────────────────

function extractYouMedItems(html, sourcePlatform = 'youmed') {
  const items = [];
  const seen = new Set();

  // 1. Fallback for WordPress REST API JSON output (/wp-json/app/v2/specialities)
  if (html.trim().startsWith('{') || html.trim().startsWith('[')) {
    try {
      const data = JSON.parse(html);
      const specs = Array.isArray(data) ? data : data?.data?.specialities;
      if (Array.isArray(specs) && specs.length > 0) {
        for (const sp of specs) {
          const slug = sp.speciality || sp.slug;
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);

          const title = stripTags(sp.name || '');
          items.push(buildPostItem({
            platform: 'youmed',
            externalId: slug,
            title,
            contentParts: [title, sp.name_en].filter(Boolean),
            authorId: `youmed:specialty:${slug}`,
            authorName: 'YouMed',
            postUrl: `https://youmed.vn/dat-kham/bac-si?speciality=${slug}`,
            mediaUrls: sp.image ? [sp.image] : [],
            metadata: {
              facilityName: '',
              doctorName: null,
              specialty: title,
              businessType: 'specialty',
              hotline: null,
              phone: null,
              phoneMasked: false,
              address: '',
              city: '',
              district: '',
              gpsLat: null,
              gpsLng: null,
              operationHours: null,
              license: null,
              pharmacist: null,
              detailUrl: `https://youmed.vn/dat-kham/bac-si?speciality=${slug}`,
              sourcePlatform,
            },
          }));
        }
        if (items.length > 0) return items;
      }
    } catch {
      // not json, continue to HTML parse
    }
  }

  // 2. Match SSR doctor-card blocks
  const cardMatches = html.match(/<(?:app-[a-z-]+doctor-card|div|article|section)[^>]*class=["'][^"']*doctor-card[^"']*["'][^>]*>[\s\S]*?<\/(?:app-[a-z-]+doctor-card|div|article|section)>/gi) ||
    html.match(/<app-[a-z-]+doctor-card[^>]*>[\s\S]*?<\/app-[a-z-]+doctor-card>/gi) || [];

  const blocks = cardMatches.length ? cardMatches : (html.match(/<a[^>]*href=["']\/dat-kham\/bac-si\/[^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || []);

  for (const block of blocks) {
    const linkMatch = block.match(/href=["'](\/dat-kham\/bac-si\/[^"']+)["']/i);
    const href = linkMatch ? linkMatch[1] : '';
    const cleanHref = href.split('?')[0].replace(/\/+$/, '');
    const slug = cleanHref ? cleanHref.split('/').pop() : '';
    if (!slug || seen.has(slug) || slug === 'search' || slug === 'bac-si' || slug === 'danh-sach') continue;
    seen.add(slug);

    const nameMatch = block.match(/<h[234][^>]*>([^<]+)<\/h[234]>/i) || block.match(/alt=["']([^"']+)["']/i);
    const doctorName = nameMatch ? stripTags(nameMatch[1]).trim() : '';

    const specialtyMatch = block.match(/<li[^>]*specialties[^>]*>([^<]+)<\/li>/i) ||
      block.match(/<span[^>]*class=["'][^"']*specialty[^"']*["'][^>]*>([^<]+)<\/span>/i);
    const specialty = specialtyMatch ? stripTags(specialtyMatch[1]).trim() : null;

    const imgMatch = block.match(/<img[^>]*src=["']([^"']+)["']/i);
    const avatar = imgMatch ? imgMatch[1] : null;

    const hospitalMatch = block.match(/<span[^>]*class=["'][^"']*hospital[^"']*["'][^>]*>([^<]+)<\/span>/i);
    const facilityName = hospitalMatch ? stripTags(hospitalMatch[1]).trim() : '';

    const detailUrl = `https://youmed.vn/dat-kham/bac-si/${slug}`;

    items.push(buildPostItem({
      platform: 'youmed',
      externalId: slug,
      title: doctorName,
      contentParts: [doctorName, specialty, facilityName].filter(Boolean),
      authorId: `youmed:${slug}`,
      authorName: doctorName || 'Bác sĩ YouMed',
      postUrl: detailUrl,
      mediaUrls: avatar ? [avatar] : [],
      metadata: {
        facilityName,
        doctorName,
        specialty,
        businessType: 'doctor',
        hotline: null,
        phone: null,
        phoneMasked: false,
        address: '',
        city: '',
        district: '',
        gpsLat: null,
        gpsLng: null,
        operationHours: null,
        license: null,
        pharmacist: null,
        detailUrl,
        sourcePlatform,
      },
    }));
  }

  return items;
}

function extractYouMedDetail(html, sourcePlatform = 'youmed', options = {}) {
  const listingItems = extractYouMedItems(html, sourcePlatform);
  if (listingItems.length > 0) return listingItems.slice(0, 1);

  // Standalone doctor detail page
  const titleMatch = html.match(/<h[123][^>]*>([^<]+)<\/h[123]>/i) || html.match(/<title>([^<|]+)/i);
  const doctorName = titleMatch ? stripTags(titleMatch[1]).trim() : '';
  if (!doctorName) return [];

  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const hrefMatch = html.match(/href=["'](\/dat-kham\/bac-si\/[^"']+)["']/i);
  const detailUrl = canonicalMatch ? canonicalMatch[1] : (hrefMatch ? `https://youmed.vn${hrefMatch[1]}` : '');
  const externalId = options.id || options.slug || (detailUrl ? detailUrl.split('/').pop() || 'youmed-doctor' : 'youmed-doctor');

  const specialtyMatch = html.match(/class=["'][^"']*specialt[^"']*["'][^>]*>([^<]+)/i);
  const specialty = specialtyMatch ? stripTags(specialtyMatch[1]).trim() : null;

  const hospitalMatch = html.match(/class=["'][^"']*hospital[^"']*["'][^>]*>([^<]+)/i);
  const facilityName = hospitalMatch ? stripTags(hospitalMatch[1]).trim() : '';

  return [buildPostItem({
    platform: 'youmed',
    externalId,
    title: doctorName,
    contentParts: [doctorName, specialty, facilityName].filter(Boolean),
    authorId: `youmed:${externalId}`,
    authorName: doctorName,
    postUrl: detailUrl,
    mediaUrls: [],
    metadata: {
      facilityName,
      doctorName,
      specialty,
      businessType: 'doctor',
      hotline: null,
      phone: null,
      phoneMasked: false,
      address: '',
      city: '',
      district: '',
      gpsLat: null,
      gpsLng: null,
      operationHours: null,
      license: null,
      pharmacist: null,
      detailUrl,
      sourcePlatform,
    },
  })];
}

/**
 * Main normalizer entry point for healthcare results.
 * @param {string | Buffer | Object} data
 * @param {string} [kind='search']
 * @param {Object} [options={}]
 * @returns {import('../../core/types.js').PostItem[]}
 */
export function normalizeHealthcareResults(data, kind = 'search', options = {}) {
  const platform = options.platform || 'medpro';
  const sourcePlatform = options.sourcePlatform || platform;

  let html = '';
  if (typeof data === 'string') {
    html = data;
  } else if (Buffer.isBuffer(data)) {
    html = data.toString('utf-8');
  } else if (data && typeof data === 'object') {
    html = typeof data.body === 'string' ? data.body : JSON.stringify(data);
  }

  if (!html || html.length < 50) return [];

  if (kind === 'detail') {
    if (platform === 'medpro') return extractMedproDetail(html, sourcePlatform);
    if (platform === 'nhathuoclongchau') return extractLongChauDetail(html, sourcePlatform);
    if (platform === 'youmed') return extractYouMedDetail(html, sourcePlatform, options);
  }

  if (platform === 'medpro') {
    return extractMedproItems(html, sourcePlatform);
  }
  if (platform === 'nhathuoclongchau') {
    return extractLongChauItems(html, sourcePlatform);
  }
  if (platform === 'youmed') {
    return extractYouMedItems(html, sourcePlatform);
  }

  return [];
}
