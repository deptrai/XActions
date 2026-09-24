// by nichxbt — tests/web/security.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/security/page.tsx'), 'utf8');

describe('security page', () => {
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

describe('security specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/security/page.tsx'), 'utf8');
  it('has security items', () => {
    expect(src).toContain('SEEDED_SECURITY');
    expect(src).toContain('Session Cookie');
  });
  it('has audit log', () => {
    expect(src).toContain('AUDIT_LOG');
  });
});
