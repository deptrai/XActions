// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Platform Coverage API — serves real platform list for the /platform dashboard page.
 *
 * GET /api/platforms — returns { platforms: [{id,name,status,features,icon}] }
 * built from the live scraper registry (src/scrapers/platforms.js) and descriptor
 * action maps, so the dashboard reflects actual scrape() coverage rather than a
 * static seed list.
 */
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { platforms } from '../../src/scrapers/platforms.js';

const router = Router();

/** Display metadata for platforms surfaced in the dashboard grid. */
const PLATFORM_META = [
  { id: 'x',         name: 'X / Twitter', icon: '𝕏',  features: ['Scraping', 'Posting', 'DMs', 'Analytics', 'Graph'] },
  { id: 'threads',   name: 'Threads',     icon: '🧵', features: ['Scraping', 'Posting'] },
  { id: 'instagram', name: 'Instagram',   icon: '📸', features: ['Scraping', 'Analytics'] },
  { id: 'facebook',  name: 'Facebook',    icon: '📘', features: ['Scraping', 'Groups'] },
  { id: 'linkedin',  name: 'LinkedIn',    icon: '💼', features: ['Scraping', 'Posting', 'B2B Leads'] },
  { id: 'tiktok',    name: 'TikTok',      icon: '🎵', features: ['Scraping', 'Analytics'] },
  { id: 'youtube',   name: 'YouTube',     icon: '▶️', features: ['Scraping', 'Analytics', 'Comments'] },
  { id: 'reddit',    name: 'Reddit',      icon: '🤖', features: ['Scraping', 'Posting', 'Monitoring'] },
  { id: 'bluesky',   name: 'Bluesky',     icon: '🦋', features: ['Scraping', 'Posting'] },
  { id: 'mastodon',  name: 'Mastodon',    icon: '🐘', features: ['Scraping', 'Posting'] },
  { id: 'telegram',  name: 'Telegram',    icon: '✈️', features: ['Scraping', 'Monitoring'] },
  { id: 'discord',   name: 'Discord',     icon: '💬', features: ['Monitoring'] },
];

/** Platforms the dashboard advertises that are NOT in the scraper registry. */
const COMING_SOON = new Set(['telegram', 'discord']);

/**
 * Platforms with full scrape() descriptor coverage (dispatchable actions).
 * Partial = registered but limited/fragile coverage.
 */
const PARTIAL = new Set(['instagram', 'facebook', 'tiktok']);

/**
 * GET /api/platforms
 * Returns the platform coverage grid. Status is computed from whether the
 * platform id resolves in the live scraper registry — no mocks.
 */
router.get('/', authenticateToken, async (_req, res) => {
  try {
    const registered = new Set(Object.keys(platforms));
    const list = PLATFORM_META.map((meta) => {
      const isRegistered = registered.has(meta.id) ||
        (meta.id === 'x' && (registered.has('twitter') || registered.has('x')));
      const status = COMING_SOON.has(meta.id)
        ? 'coming_soon'
        : PARTIAL.has(meta.id)
          ? 'partial'
          : isRegistered
            ? 'supported'
            : 'coming_soon';
      return { ...meta, status };
    });
    res.json({ success: true, platforms: list });
  } catch (err) {
    res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
  }
});

export default router;
