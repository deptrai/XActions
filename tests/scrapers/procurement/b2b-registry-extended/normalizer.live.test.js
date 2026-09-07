// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtended live HTML and JSON normalizer tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeB2BRegistryResults } from '../../../../src/scrapers/procurement/b2b-registry-extended/normalizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../../../../tests/fixtures/b2b-registry-extended');

async function loadFixture(name) {
  return readFile(join(fixturesDir, name), 'utf-8');
}

describe('B2BRegistryExtended live normalizer', () => {
  it('should normalize HoSoCongTy detail HTML from live site', async () => {
    const html = await loadFixture('hosocongty-detail.html');
    const posts = normalizeB2BRegistryResults(html, 'detail', { platform: 'hosocongty' });

    expect(posts.length).toBe(1);
    const post = posts[0];
    expect(post.platform).toBe('hosocongty');
    expect(post.externalId).toBe('1702372113');
    expect(post.title).toBe('CÔNG TY TNHH XÂY DỰNG VÀ THƯƠNG MẠI KỸ THUẬT HƯNG THỊNH PHÁT');
    expect(post.metadata.companyName).toBe('CÔNG TY TNHH XÂY DỰNG VÀ THƯƠNG MẠI KỸ THUẬT HƯNG THỊNH PHÁT');
    expect(post.metadata.shortName).toBe('HUNG THINH PHAT C&T CO,. LTD');
    expect(post.authorId).toBe('hosocongty:1702372113');
    expect(post.authorName).toBe('Lưu Trọng Nghĩa');
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.metadata.taxCode).toBe('1702372113');
    expect(post.metadata.phone).toBe('03353416**');
    expect(post.metadata.status).toBe('Đang Hoạt Động');
    expect(post.metadata.address).toContain('Phú Quốc');
    expect(post.metadata.establishedDate).toBe('04/09/2026');
  });

  it('should normalize HoSoCongTy search HTML from live site', async () => {
    const html = await loadFixture('hosocongty-search.html');
    const posts = normalizeB2BRegistryResults(html, 'search', { platform: 'hosocongty' });

    expect(posts.length).toBe(2);
    const first = posts[0];
    expect(first.platform).toBe('hosocongty');
    expect(first.externalId).toBe('0123456789');
    expect(first.title).toBe('CÔNG TY TNHH ABC');
    expect(first.metadata.address).toContain('Lê Lợi');

    const second = posts[1];
    expect(second.externalId).toBe('4401134992');
    expect(second.title).toBe('TRƯỜNG TIỂU HỌC TUY AN ĐÔNG');
  });

  it('should normalize MuaSamCong search JSON from live REST endpoint', async () => {
    const json = await loadFixture('muasamcong-search.json');
    const posts = normalizeB2BRegistryResults(json, 'search', { platform: 'muasamcong' });

    expect(posts.length).toBeGreaterThan(0);
    const first = posts[0];
    expect(first.platform).toBe('muasamcong');
    expect(first.externalId).toBe('IB2600512737');
    expect(first.title).toContain('Mua sắm cồng chiêng');
    expect(first.authorName).toBe('Phòng Văn hoá - Xã hội xã Trà Linh');
    expect(first.publishedAt).toBeInstanceOf(Date);
    expect(first.metadata.bidStatus).toBe('IS_PUBLISH');
  });

  it('should normalize MuaSamCong detail JSON from live REST endpoint', async () => {
    const json = await loadFixture('muasamcong-detail.json');
    const posts = normalizeB2BRegistryResults(json, 'detail', { platform: 'muasamcong' });

    expect(posts.length).toBe(1);
    const post = posts[0];
    expect(post.platform).toBe('muasamcong');
    expect(post.externalId).toBe('IB2600482481');
    expect(post.title).toBe('Gói số 01: Thi công xây dựng');
    expect(post.authorName).toBe('Sở Xây dựng tỉnh Ninh Bình');
    expect(post.metadata.planNo).toBe('PL2600274818');
    expect(post.metadata.bidValue).toContain('325.171.000 VND');
    expect(post.publishedAt).toBeInstanceOf(Date);
  });

  it('should normalize MuaSamCong search HTML fallback fixture', async () => {
    const html = await loadFixture('muasamcong-search.html');
    const posts = normalizeB2BRegistryResults(html, 'search', { platform: 'muasamcong' });

    expect(posts.length).toBe(1);
    const post = posts[0];
    expect(post.platform).toBe('muasamcong');
    expect(post.externalId).toBe('IB2600511963-00');
    expect(post.title).toBe('Cung cấp dịch vụ ăn, nghỉ');
    expect(post.authorName).toBe('Cục Quản trị Văn phòng Quốc hội');
    expect(post.metadata.bidStatus).toBe('Chưa đóng thầu');
  });

  it('should normalize MuaSamCong detail HTML fallback fixture', async () => {
    const html = await loadFixture('muasamcong-detail.html');
    const posts = normalizeB2BRegistryResults(html, 'detail', { platform: 'muasamcong' });

    expect(posts.length).toBe(1);
    const post = posts[0];
    expect(post.platform).toBe('muasamcong');
    expect(post.externalId).toBe('IB2600511963');
    expect(post.title).toBe('Cung cấp dịch vụ ăn, nghỉ');
    expect(post.metadata.bidValue).toBe('133.000.000 VND');
    expect(post.publishedAt).toBeInstanceOf(Date);
  });
});
