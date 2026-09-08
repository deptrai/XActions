// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare platform response validator (Medpro, YouMed, Long Chau).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class HealthcarePlatformResponseValidator extends AbstractPlatformResponseValidator {
  constructor() {
    super('healthcare');
  }

  /**
   * @param {any} body
   * @returns {string}
   */
  #getText(body) {
    if (typeof body === 'string') return body;
    if (Buffer.isBuffer(body)) return body.toString('utf-8');
    if (body && typeof body === 'object') {
      try { return JSON.stringify(body); } catch { return ''; }
    }
    return '';
  }

  /**
   * Check if response payload contains valid healthcare data signals.
   * @param {any} body
   * @param {Record<string, any>} [response]
   * @returns {boolean}
   */
  isValidPayload(body, response = {}) {
    const text = this.#getText(body);
    if (!text || text.length < 50) return false;

    // Challenge / block markers
    if (this.isBotChallenge({ status: response.status || 200, body: text })) {
      return false;
    }

    // Medpro: Next.js SSR with initialHospitals or hospital listing
    if (text.includes('initialHospitals') || (text.includes('__NEXT_DATA__') && /bệnh viện|phòng khám|cơ sở y tế/i.test(text))) {
      return true;
    }

    // Long Chau: Next.js SSR with initialPharmacyRecommended or store listing
    if (text.includes('initialPharmacyRecommended') || (text.includes('__NEXT_DATA__') && /nhà thuốc|long châu|he-thong-cua-hang/i.test(text))) {
      return true;
    }

    // YouMed: SSR with doctor-card or WP REST JSON specialities
    if (text.includes('doctor-card') || text.includes('specialities') || (text.includes('tin-tuc/wp-json') && /"code":\s*200/.test(text))) {
      return true;
    }

    // Generic healthcare keywords as secondary fallback
    const healthKeywords = [
      'bác sĩ', 'bác sỹ', 'phòng khám', 'bệnh viện', 'chuyên khoa',
      'nhà thuốc', 'dược phẩm', 'đặt lịch khám', 'khám bệnh'
    ];
    let matched = 0;
    const lower = text.toLowerCase();
    for (const kw of healthKeywords) {
      if (lower.includes(kw)) matched++;
      if (matched >= 2) return true;
    }

    return false;
  }

  /**
   * Check for bot challenge or WAF block.
   * @param {{ status?: number, body?: any }} response
   * @returns {boolean}
   */
  isBotChallenge(response = {}) {
    const status = response.status;
    const text = this.#getText(response.body);

    if (status === 403 || status === 429) {
      if (/cloudflare|just a moment|cf-browser-verification|challenge-platform|ddos-guard|waf/i.test(text)) {
        return true;
      }
    }

    if (/cf-browser-verification|ray id:|captcha|challenge-running/i.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * @returns {boolean}
   */
  isLoginWall() {
    return false;
  }

  /**
   * @returns {boolean}
   */
  isAuthExpired() {
    return false;
  }
}
