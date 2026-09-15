// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for complete 24-platform coverage in x_actions_list (Story 20.1).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { executeActionListTool } from '../../src/scrapers/social/actions-list.js';

const CANONICAL_24 = [
  'twitter', 'bluesky', 'mastodon', 'facebook', 'threads', 'reddit', 'medium', 'instagram',
  'tiktok', 'youtube', 'zalo', 'tiktokshop', 'fnb', 'healthcare', 'ipvietnam', 'automotive',
  'b2b_registry_extended', 'linkedin', 'batdongsan', 'chotot', 'shopee', 'topcv', 'vietnamworks', 'masothue',
];

describe('actions-list complete 24 platforms', () => {
  it('covers all 24 canonical platforms', async () => {
    const actions = await executeActionListTool({ detailLevel: 'full' });
    const discoveredPlatforms = new Set(actions.map((a) => a.platform));

    for (const canonical of CANONICAL_24) {
      assert.ok(
        discoveredPlatforms.has(canonical),
        `Expected platform "${canonical}" to be in actions list`
      );
    }
  });

  it('ensures no action descriptor contains a checkpointResolver function', async () => {
    const actions = await executeActionListTool({ detailLevel: 'full' });
    for (const action of actions) {
      assert.equal(action.checkpointResolver, undefined, `action ${action.action} should not have checkpointResolver`);
    }
  });

  it('filters actions by platform alias', async () => {
    const fbActions = await executeActionListTool({ platform: 'fb' });
    assert.ok(fbActions.length > 0);
    for (const a of fbActions) {
      assert.equal(a.platform, 'facebook');
    }

    const mstActions = await executeActionListTool({ platform: 'mst' });
    assert.ok(mstActions.length > 0);
    for (const a of mstActions) {
      assert.equal(a.platform, 'masothue');
    }
  });

  it('filters actions by category', async () => {
    const ecomActions = await executeActionListTool({ category: 'ecom' });
    assert.ok(ecomActions.length > 0);
    const ecomPlatforms = new Set(ecomActions.map((a) => a.platform));
    assert.ok(ecomPlatforms.has('shopee'));
    assert.ok(ecomPlatforms.has('tiktokshop'));

    for (const a of ecomActions) {
      assert.equal(a.category, 'ecom');
    }
  });

  it('returns summary shape when detailLevel is summary', async () => {
    const summaryActions = await executeActionListTool({ detailLevel: 'summary' });
    assert.ok(summaryActions.length > 0);
    const sample = summaryActions[0];

    assert.ok('platform' in sample);
    assert.ok('action' in sample);
    assert.ok('description' in sample);
    assert.ok('requiredArgs' in sample);
    assert.ok('no_crawler' in sample);
    assert.ok('category' in sample);
    assert.equal(sample.optionalArgs, undefined);
    assert.equal(sample.example, undefined);
  });
});
