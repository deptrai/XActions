// by nichxbt — tests/web/osint.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/osint/page.tsx'), 'utf8');

describe('OSINT page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
  it('has search form', () => {
    expect(src).toContain('handleSearch');
    expect(src).toContain('handle');
  });
  it('calls osint/find-profiles endpoint', () => {
    expect(src).toContain('/api/osint/find-profiles');
  });
  it('has cluster tab', () => {
    expect(src).toContain('Identity Clusters');
    expect(src).toContain('clusters');
  });
  it('has platform colors', () => {
    expect(src).toContain('PLATFORM_COLORS');
  });
  it('shows error state', () => {
    expect(src).toContain('error');
    expect(src).toContain('AlertCircle');
  });
  it('no raw fetch calls', () => {
    expect(src).not.toContain('fetch(');
  });
});
