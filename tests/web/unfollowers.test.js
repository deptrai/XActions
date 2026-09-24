// by nichxbt — tests/web/unfollowers.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/unfollowers/page.tsx'), 'utf8');

describe('unfollowers page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
  it('has no raw fetch calls', () => {
    expect(src).not.toContain('fetch(');
  });
});

describe('unfollowers specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/unfollowers/page.tsx'), 'utf8');
  it('has CSV export', () => {
    expect(src).toContain('exportCSV');
    expect(src).toContain('Blob');
  });
  it('has filter tabs', () => {
    expect(src).toContain('mutual');
    expect(src).toContain('verified');
  });
});
