// by nichxbt — tests/web/jev-test.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/jev-test/page.tsx'), 'utf8');

describe('jev-test page', () => {
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
