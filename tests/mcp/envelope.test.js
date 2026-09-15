// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for envelope.js: VN crawlers extractRecords, preview limit, sampleIds, artifact exports.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { wrapToolResult } from '../../src/mcp/envelope.js';

describe('envelope.js VN crawlers extractRecords', () => {
  it('extracts listings array from Vietnamese real-estate/classifieds crawlers', async () => {
    const listings = [
      { id: 'l1', title: 'Nhà bán Quận 1' },
      { id: 'l2', title: 'Căn hộ chung cư Bình Thạnh' },
    ];
    const envelope = await wrapToolResult('x_scrape', { listings }, Date.now(), {
      args: { platform: 'chotot', action: 'search_listings' },
    });

    assert.equal(envelope.success, true);
    assert.equal(envelope.platform, 'chotot');
    assert.equal(envelope.meta.totalRecords, 2);
    assert.deepEqual(envelope.data, listings);
    assert.deepEqual(envelope.summary.sampleIds, ['l1', 'l2']);
  });

  it('extracts products array from Vietnamese ecom crawlers', async () => {
    const products = [
      { id: 'p1', name: 'Áo thun nam' },
      { id: 'p2', name: 'Giày sneaker nữ' },
    ];
    const envelope = await wrapToolResult('x_scrape', { products }, Date.now(), {
      args: { platform: 'shopee', action: 'search' },
    });

    assert.equal(envelope.success, true);
    assert.equal(envelope.platform, 'shopee');
    assert.equal(envelope.meta.totalRecords, 2);
    assert.deepEqual(envelope.data, products);
    assert.deepEqual(envelope.summary.sampleIds, ['p1', 'p2']);
  });

  it('extracts jobs array from Vietnamese recruitment crawlers', async () => {
    const jobs = [
      { id: 'j1', title: 'Senior Node.js Developer' },
      { id: 'j2', title: 'Product Manager' },
    ];
    const envelope = await wrapToolResult('x_scrape', { jobs }, Date.now(), {
      args: { platform: 'topcv', action: 'search_jobs' },
    });

    assert.equal(envelope.success, true);
    assert.equal(envelope.platform, 'topcv');
    assert.equal(envelope.meta.totalRecords, 2);
    assert.deepEqual(envelope.data, jobs);
    assert.deepEqual(envelope.summary.sampleIds, ['j1', 'j2']);
  });

  it('passes through already wrapped unified envelopes without double-wrapping', async () => {
    const originalEnvelope = {
      success: true,
      mode: 'stream',
      platform: 'facebook',
      meta: { tool: 'x_scrape', durationMs: 10, totalRecords: 5 },
      data: [{ id: 'fb1' }],
      stream: { enabled: true, name: 'stream:social:raw_posts', cursor: '123-0' },
    };

    const wrapped = await wrapToolResult('x_scrape', originalEnvelope, Date.now());
    assert.equal(wrapped, originalEnvelope);
  });
});
