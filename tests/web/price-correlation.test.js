// by nichxbt — tests/web/price-correlation.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/price-correlation/page.tsx'), 'utf8');

describe('Price Correlation page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
  it('has token price table', () => {
    expect(src).toContain('SEEDED_TOKENS');
    expect(src).toContain('BTC');
    expect(src).toContain('ETH');
  });
  it('has sparkline charts', () => {
    expect(src).toContain('Sparkline');
    expect(src).toContain('polyline');
  });
  it('has correlation matrix', () => {
    expect(src).toContain('SEEDED_PAIRS');
    expect(src).toContain('CorrelationBadge');
  });
  it('has refresh button', () => {
    expect(src).toContain('fetchData');
    expect(src).toContain('RefreshCw');
  });
  it('no raw fetch calls', () => {
    expect(src).not.toContain('fetch(');
  });
});
