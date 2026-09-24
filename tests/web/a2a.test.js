// by nichxbt — tests/web/a2a.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/a2a/page.tsx'), 'utf8');

describe('a2a page', () => {
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

describe('a2a page specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/a2a/page.tsx'), 'utf8');
  it('uses EventSource for SSE', () => {
    expect(src).toContain('EventSource');
    expect(src).toContain('/api/a2a/stream');
  });
  it('has agent list', () => {
    expect(src).toContain('SEEDED_AGENTS');
    expect(src).toContain('capabilities');
  });
  it('has message stream', () => {
    expect(src).toContain('SEEDED_MESSAGES');
    expect(src).toContain('sendMessage');
  });
});
