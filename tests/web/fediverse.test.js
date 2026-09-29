// by nichxbt — tests/web/fediverse.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const pageSrc = readFileSync(join(__dirname, '../../apps/web/app/fediverse/page.tsx'), 'utf8');
const navSrc = readFileSync(join(__dirname, '../../apps/web/lib/nav.ts'), 'utf8');

describe('fediverse page architecture & constraints', () => {
  it('is a client component', () => {
    expect(pageSrc).toContain("'use client'");
  });

  it('imports api helper from @/lib/api', () => {
    expect(pageSrc).toContain("from '@/lib/api'");
  });

  it('has no raw fetch calls to backend or external apis', () => {
    expect(pageSrc).not.toContain('fetch(');
  });

  it('routes scrape requests through same-origin BFF /api/platform/bluesky/scrape and /api/platform/mastodon/scrape', () => {
    expect(pageSrc).toContain('/api/platform/${platform}/scrape');
    expect(pageSrc).toContain("'bluesky'");
    expect(pageSrc).toContain("'mastodon'");
  });

  it('calls feed (whats-hot), posts, and trending actions', () => {
    expect(pageSrc).toContain("'feed'");
    expect(pageSrc).toContain("'posts'");
    expect(pageSrc).toContain("'trending'");
  });

  it('uses the canonical whats-hot custom feed uri', () => {
    expect(pageSrc).toContain('at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot');
  });

  it('requests sync mode and limit 30', () => {
    expect(pageSrc).toContain("mode: 'sync'");
    expect(pageSrc).toContain('PAGE_LIMIT = 30');
  });

  it('never passes credentials (identifier/password/accessToken)', () => {
    expect(pageSrc).not.toContain('identifier');
    expect(pageSrc).not.toContain('password');
    expect(pageSrc).not.toContain('accessToken');
  });

  it('reads PostItem fields used by the deck', () => {
    expect(pageSrc).toContain('authorName');
    expect(pageSrc).toContain('authorAvatar');
    expect(pageSrc).toContain('content');
    expect(pageSrc).toContain('mediaUrls');
    expect(pageSrc).toContain('likesCount');
    expect(pageSrc).toContain('repostsCount');
    expect(pageSrc).toContain('publishedAt');
    expect(pageSrc).toContain('postUrl');
    expect(pageSrc).toContain('platform');
  });

  it('implements infinite scroll with cursor from pageInfo.end_cursor for Bluesky columns', () => {
    expect(pageSrc).toContain('IntersectionObserver');
    expect(pageSrc).toContain('end_cursor');
    expect(pageSrc).toContain('has_next_page');
    expect(pageSrc).toContain('onVisible');
  });

  it('skips infinite scroll for Mastodon trending (no pagination)', () => {
    expect(pageSrc).toContain('paginated: false');
    expect(pageSrc).toContain('def?.paginated');
  });

  it('enforces referrerPolicy="no-referrer" for external fediverse media', () => {
    expect(pageSrc).toContain('referrerPolicy="no-referrer"');
  });

  it('has media onError fallback and a click lightbox modal', () => {
    expect(pageSrc).toContain('onError');
    expect(pageSrc).toContain('lightbox');
    expect(pageSrc).toContain('setLightbox');
  });

  it('isolates errors per column with empty state and Retry', () => {
    expect(pageSrc).toContain('Retry');
    expect(pageSrc).toContain('state.error');
  });

  it('renders 3 columns: Bluesky Hot, Bluesky Profile, Mastodon', () => {
    expect(pageSrc).toContain('Bluesky Hot');
    expect(pageSrc).toContain('Bluesky Profile');
    expect(pageSrc).toContain('Mastodon');
    expect(pageSrc).toContain('lg:grid-cols-3');
  });

  it('mobile (<1024px) shows a tab bar with one column at a time', () => {
    expect(pageSrc).toContain('lg:hidden');
    expect(pageSrc).toContain('activeColumn');
    expect(pageSrc).toContain("role=\"tab\"");
  });

  it('desktop (>=1024px) shows 3 parallel columns', () => {
    expect(pageSrc).toContain('lg:block');
  });

  it('supports per-column refresh and Refresh All', () => {
    expect(pageSrc).toContain('Refresh All');
    expect(pageSrc).toContain('fetchColumn(col)');
  });

  it('copies postUrl permalink to clipboard with ~1.5s check state', () => {
    expect(pageSrc).toContain('clipboard.writeText');
    expect(pageSrc).toContain('1500');
  });

  it('has a profile handle input defaulting to bsky.app', () => {
    expect(pageSrc).toContain("DEFAULT_PROFILE_HANDLE = 'bsky.app'");
    expect(pageSrc).toContain('handle:');
  });
});

describe('fediverse navigation integration', () => {
  it('registers /fediverse under Intelligence nav group in nav.ts', () => {
    expect(navSrc).toContain('/fediverse');
    expect(navSrc).toContain('Fediverse');
  });
});
