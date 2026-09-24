// by nichxbt — tests/web/agent.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/agent/page.tsx'), 'utf8');

describe('agent page', () => {
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

describe('agent specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/agent/page.tsx'), 'utf8');
  it('has agent list', () => {
    expect(src).toContain('SEEDED_AGENTS');
    expect(src).toContain('persona');
  });
  it('has start/pause', () => {
    expect(src).toContain('toggleAgent');
  });
});
