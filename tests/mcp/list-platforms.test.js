// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// XActions — x_list_platforms runtime contract tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import { x_list_platforms, toolMap } from '../../src/mcp/local-tools.js';

// ============================================================================
// AC — x_list_platforms runtime contract
// ============================================================================

describe('x_list_platforms runtime', () => {
  it('is exported from local-tools and registered in toolMap', () => {
    expect(typeof x_list_platforms).toBe('function');
    expect(toolMap).toHaveProperty('x_list_platforms');
    expect(toolMap.x_list_platforms).toBe(x_list_platforms);
  });

  it('returns supported platforms and capabilities', async () => {
    const result = await x_list_platforms();

    expect(result).toBeDefined();
    expect(Array.isArray(result.platforms)).toBe(true);
    expect(result.platforms.length).toBeGreaterThanOrEqual(5);

    const names = result.platforms.map((p) => p.name);
    expect(names).toContain('twitter');
    expect(names).toContain('bluesky');
    expect(names).toContain('mastodon');
    expect(names).toContain('threads');
    expect(names).toContain('facebook');
  });

  it('includes facebook with fb alias and core capabilities', async () => {
    const result = await x_list_platforms();
    const fb = result.platforms.find((p) => p.name === 'facebook');

    expect(fb).toBeDefined();
    expect(fb.aliases).toContain('fb');
    expect(fb.auth).toMatch(/c_user.*xs/);

    for (const cap of ['profile', 'posts', 'like', 'comment', 'post', 'warmup_scroll']) {
      expect(fb.capabilities, `Facebook missing capability: ${cap}`).toContain(cap);
    }
  });

  it('includes twitter with x alias and core capabilities', async () => {
    const result = await x_list_platforms();
    const tw = result.platforms.find((p) => p.name === 'twitter');

    expect(tw).toBeDefined();
    expect(tw.aliases).toContain('x');
    expect(tw.capabilities).toContain('profile');
    expect(tw.capabilities).toContain('post');
    expect(tw.capabilities).toContain('follow');
  });
});
