// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Epic 41: Identity Intelligence & OSINT Crawlers
 *
 * Verifies end-to-end flow:
 * 1. GitHub public developer profile crawler without API keys
 * 2. Gravatar public avatar and identity resolver via SHA-256 email hash
 * 3. Unified scrape() dispatcher integration for identity platforms
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { GitHubCrawler } from '../../src/scrapers/identity/github/crawler.js';
import { GravatarCrawler } from '../../src/scrapers/identity/gravatar/crawler.js';
import { scrape } from '../../src/scrapers/index.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-identity-osint';

describe('OSINT — Identity Intelligence Crawlers E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GitHubCrawler extracts live developer profile from GitHub`, async () => {
    const crawler = new GitHubCrawler();
    const res = await crawler.getProfile({ username: 'torvalds' });
    const profile = res.profile || res;

    expect(profile).toBeDefined();
    expect(profile.username).toBe('torvalds');
    expect(profile.name).toBe('Linus Torvalds');
    expect(profile.profileUrl).toContain('github.com/torvalds');
    expect(profile.followersCount).toBeGreaterThan(100000);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GravatarCrawler resolves profile from public email hash`, async () => {
    const crawler = new GravatarCrawler();
    const res = await crawler.getProfile({ email: 'beau@dentedreality.com.au' });
    const profile = res.profile || res;

    expect(profile).toBeDefined();
    expect(profile.username).toBe('Beau Lebens');
    expect(profile.avatar).toBeTruthy();
    expect(profile.profileUrl).toContain('gravatar.com/beau');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes GitHub profile extraction through unified scrape() dispatcher`, async () => {
    const res = await scrape('github', 'profile', {
      username: 'gvanrossum',
    });
    const profile = res.profile || res;

    expect(profile).toBeDefined();
    expect(profile.username).toBe('gvanrossum');
    expect(profile.name).toBe('Guido van Rossum');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] executes Gravatar resolution through unified scrape() dispatcher`, async () => {
    const res = await scrape('gravatar', 'profile', {
      email: 'beau@dentedreality.com.au',
    });
    const profile = res.profile || res;

    expect(profile).toBeDefined();
    expect(profile.username).toBe('Beau Lebens');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GitHubCrawler rejects empty username with XACT_4001`, async () => {
    const crawler = new GitHubCrawler();
    await expect(crawler.getProfile({})).rejects.toMatchObject({
      code: 'XACT_4001',
    });
  });
});
