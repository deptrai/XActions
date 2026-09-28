// by nichxbt — tests/web/dexscreener.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const pageSrc = readFileSync(join(__dirname, '../../apps/web/app/dexscreener/page.tsx'), 'utf8');
const navSrc = readFileSync(join(__dirname, '../../apps/web/lib/nav.ts'), 'utf8');

describe('dexscreener page architecture & constraints', () => {
  it('is a client component', () => {
    expect(pageSrc).toContain("'use client'");
  });

  it('imports api helper from @/lib/api', () => {
    expect(pageSrc).toContain("from '@/lib/api'");
  });

  it('has no raw fetch calls to backend or external apis', () => {
    expect(pageSrc).not.toContain('fetch(');
  });

  it('routes scrape requests through same-origin BFF /api/platform/dexscreener/scrape', () => {
    expect(pageSrc).toContain("'/api/platform/dexscreener/scrape'");
  });

  it('calls token_lookup and latest_boosted actions', () => {
    expect(pageSrc).toContain("'token_lookup'");
    expect(pageSrc).toContain("'latest_boosted'");
  });

  it('enforces referrerPolicy="no-referrer" for external token images', () => {
    expect(pageSrc).toContain('referrerPolicy="no-referrer"');
  });

  it('includes Pump.fun Origin badge linking to /pumpfun?mint=', () => {
    expect(pageSrc).toContain('/pumpfun?mint=');
    expect(pageSrc).toContain('Pump.fun Origin');
  });

  it('has empty state and Retry handling for upstream errors', () => {
    expect(pageSrc).toContain('Retry');
    expect(pageSrc).toContain('Không tìm thấy cặp giao dịch');
  });

  it('provides copy pair address functionality', () => {
    expect(pageSrc).toContain('Copy Pair Address');
    expect(pageSrc).toContain('clipboard.writeText');
  });

  it('supports chain selection badges and sorting options', () => {
    expect(pageSrc).toContain('CHAIN_OPTIONS');
    expect(pageSrc).toContain('SORT_OPTIONS');
  });
});

describe('dexscreener navigation integration', () => {
  it('registers /dexscreener under Intelligence nav group in nav.ts', () => {
    expect(navSrc).toContain('/dexscreener');
    expect(navSrc).toContain('Dexscreener');
  });
});
