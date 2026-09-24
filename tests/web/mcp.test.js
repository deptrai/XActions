// by nichxbt — tests/web/mcp.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/mcp/page.tsx'), 'utf8');

describe('mcp page', () => {
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

describe('mcp specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/mcp/page.tsx'), 'utf8');
  it('has tool list', () => {
    expect(src).toContain('x_scrape_profile');
    expect(src).toContain('x_post_tweet');
  });
  it('has test call', () => {
    expect(src).toContain('testTool');
    expect(src).toContain('/api/mcp/call');
  });
});
