// by nichxbt — tests/web/analytics.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/analytics/page.tsx'), 'utf8');

describe('Analytics page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
  it('has metric cards', () => {
    expect(src).toContain('SEEDED_METRICS');
    expect(src).toContain('Total Followers');
    expect(src).toContain('Engagement Rate');
  });
  it('has bar charts', () => {
    expect(src).toContain('BarChart');
    expect(src).toContain('SEEDED_WEEKLY');
    expect(src).toContain('SEEDED_MONTHLY');
  });
  it('has period selector', () => {
    expect(src).toContain("'7d'");
    expect(src).toContain("'30d'");
  });
  it('has top posts section', () => {
    expect(src).toContain('TOP_POSTS');
    expect(src).toContain('Top Performing Posts');
  });
  it('no raw fetch calls', () => {
    expect(src).not.toContain('fetch(');
  });
});
