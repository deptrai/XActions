// by nichxbt — tests/web/thread.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/thread/page.tsx'), 'utf8');

describe('thread page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
});

describe('thread page specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/thread/page.tsx'), 'utf8');
  it('has thread list', () => {
    expect(src).toContain('SEEDED_THREADS');
  });
  it('has status filter', () => {
    expect(src).toContain('published');
    expect(src).toContain('draft');
    expect(src).toContain('scheduled');
  });
});
