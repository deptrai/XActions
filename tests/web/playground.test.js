// by nichxbt — tests/web/playground.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/playground/page.tsx'), 'utf8');

describe('playground page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
});

describe('playground specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/playground/page.tsx'), 'utf8');
  it('has model selector', () => {
    expect(src).toContain('claude-haiku-4.5');
    expect(src).toContain('MODELS');
  });
  it('has temperature slider', () => {
    expect(src).toContain('temperature');
  });
  it('calls ai/generate endpoint', () => {
    expect(src).toContain('/api/ai/generate');
  });
});
