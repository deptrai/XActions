// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThue metadata schema and province constants.
 * Province IDs scraped live from /tra-cuu-ma-so-thue-theo-tinh/.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/** @type {Record<string, { slug: string, id: number, name: string }>} */
export const MASOTHUE_PROVINCES = {
  'an-giang': { slug: 'an-giang', id: 93, name: 'An Giang' },
  'ba-ria-vung-tau': { slug: 'ba-ria-vung-tau', id: 32, name: 'Bà Rịa - Vũng Tàu' },
  'bac-giang': { slug: 'bac-giang', id: 72, name: 'Bắc Giang' },
  'bac-kan': { slug: 'bac-kan', id: 1127, name: 'Bắc Kạn' },
  'bac-lieu': { slug: 'bac-lieu', id: 197, name: 'Bạc Liêu' },
  'bac-ninh': { slug: 'bac-ninh', id: 170, name: 'Bắc Ninh' },
  'ben-tre': { slug: 'ben-tre', id: 185, name: 'Bến Tre' },
  'binh-dinh': { slug: 'binh-dinh', id: 152, name: 'Bình Định' },
  'binh-duong': { slug: 'binh-duong', id: 17, name: 'Bình Dương' },
  'binh-phuoc': { slug: 'binh-phuoc', id: 1, name: 'Bình Phước' },
  'binh-thuan': { slug: 'binh-thuan', id: 20, name: 'Bình Thuận' },
  'ca-mau': { slug: 'ca-mau', id: 108, name: 'Cà Mau' },
  'can-tho': { slug: 'can-tho', id: 96, name: 'Cần Thơ' },
  'cao-bang': { slug: 'cao-bang', id: 1612, name: 'Cao Bằng' },
  'da-nang': { slug: 'da-nang', id: 35, name: 'Đà Nẵng' },
  'dak-lak': { slug: 'dak-lak', id: 214, name: 'Đắk Lắk' },
  'dak-nong': { slug: 'dak-nong', id: 245, name: 'Đắk Nông' },
  'dien-bien': { slug: 'dien-bien', id: 1007, name: 'Điện Biên' },
  'dong-nai': { slug: 'dong-nai', id: 57, name: 'Đồng Nai' },
  'dong-thap': { slug: 'dong-thap', id: 63, name: 'Đồng Tháp' },
  'gia-lai': { slug: 'gia-lai', id: 563, name: 'Gia Lai' },
  'ha-giang': { slug: 'ha-giang', id: 529, name: 'Hà Giang' },
  'ha-nam': { slug: 'ha-nam', id: 162, name: 'Hà Nam' },
  'ha-noi': { slug: 'ha-noi', id: 7, name: 'Hà Nội' },
  'ha-tinh': { slug: 'ha-tinh', id: 342, name: 'Hà Tĩnh' },
  'hai-duong': { slug: 'hai-duong', id: 147, name: 'Hải Dương' },
  'hai-phong': { slug: 'hai-phong', id: 99, name: 'Hải Phòng' },
  'hau-giang': { slug: 'hau-giang', id: 190, name: 'Hậu Giang' },
  'ho-chi-minh': { slug: 'ho-chi-minh', id: 23, name: 'Hồ Chí Minh' },
  'hoa-binh': { slug: 'hoa-binh', id: 786, name: 'Hòa Bình' },
  'hue': { slug: 'hue', id: 16354, name: 'Huế' },
  'hung-yen': { slug: 'hung-yen', id: 123, name: 'Hưng Yên' },
  'khanh-hoa': { slug: 'khanh-hoa', id: 26, name: 'Khánh Hòa' },
  'kien-giang': { slug: 'kien-giang', id: 80, name: 'Kiên Giang' },
  'kon-tum': { slug: 'kon-tum', id: 956, name: 'Kon Tum' },
  'lai-chau': { slug: 'lai-chau', id: 2501, name: 'Lai Châu' },
  'lam-dong': { slug: 'lam-dong', id: 10, name: 'Lâm Đồng' },
  'lang-son': { slug: 'lang-son', id: 984, name: 'Lạng Sơn' },
  'lao-cai': { slug: 'lao-cai', id: 320, name: 'Lào Cai' },
  'long-an': { slug: 'long-an', id: 29, name: 'Long An' },
  'nam-dinh': { slug: 'nam-dinh', id: 137, name: 'Nam Định' },
  'nghe-an': { slug: 'nghe-an', id: 144, name: 'Nghệ An' },
  'ninh-binh': { slug: 'ninh-binh', id: 75, name: 'Ninh Bình' },
  'ninh-thuan': { slug: 'ninh-thuan', id: 11, name: 'Ninh Thuận' },
  'phu-tho': { slug: 'phu-tho', id: 134, name: 'Phú Thọ' },
  'phu-yen': { slug: 'phu-yen', id: 14, name: 'Phú Yên' },
  'quang-binh': { slug: 'quang-binh', id: 60, name: 'Quảng Bình' },
  'quang-nam': { slug: 'quang-nam', id: 49, name: 'Quảng Nam' },
  'quang-ngai': { slug: 'quang-ngai', id: 301, name: 'Quảng Ngãi' },
  'quang-ninh': { slug: 'quang-ninh', id: 142, name: 'Quảng Ninh' },
  'quang-tri': { slug: 'quang-tri', id: 69, name: 'Quảng Trị' },
  'soc-trang': { slug: 'soc-trang', id: 949, name: 'Sóc Trăng' },
  'son-la': { slug: 'son-la', id: 316, name: 'Sơn La' },
  'tay-ninh': { slug: 'tay-ninh', id: 90, name: 'Tây Ninh' },
  'thai-binh': { slug: 'thai-binh', id: 128, name: 'Thái Bình' },
  'thai-nguyen': { slug: 'thai-nguyen', id: 131, name: 'Thái Nguyên' },
  'thanh-hoa': { slug: 'thanh-hoa', id: 4, name: 'Thanh Hoá' },
  'thua-thien-hue': { slug: 'thua-thien-hue', id: 66, name: 'Thừa Thiên Huế' },
  'tien-giang': { slug: 'tien-giang', id: 177, name: 'Tiền Giang' },
  'tra-vinh': { slug: 'tra-vinh', id: 41, name: 'Trà Vinh' },
  'tuyen-quang': { slug: 'tuyen-quang', id: 1284, name: 'Tuyên Quang' },
  'vinh-long': { slug: 'vinh-long', id: 193, name: 'Vĩnh Long' },
  'vinh-phuc': { slug: 'vinh-phuc', id: 420, name: 'Vĩnh Phúc' },
  'yen-bai': { slug: 'yen-bai', id: 724, name: 'Yên Bái' },
};

/**
 * Resolve a province key (slug or hyphenated Vietnamese name) to a province entry.
 * @param {string} key
 * @returns {{ slug: string, id: number, name: string } | null}
 */
export function resolveProvince(key) {
  if (!key || typeof key !== 'string') return null;
  const normalized = key.toLowerCase().trim().replace(/\s+/g, '-');
  return MASOTHUE_PROVINCES[normalized] || null;
}

/**
 * Convert province name/slug to canonical hyphenated slug.
 * @param {string} input
 * @returns {string}
 */
export function normalizeProvinceSlug(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
