// by nichxbt — tests/web/graph.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/graph/page.tsx'), 'utf8');

describe('Graph page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
  it('renders SVG graph', () => {
    expect(src).toContain('<svg');
    expect(src).toContain('<circle');
    expect(src).toContain('<line');
  });
  it('has node click handler', () => {
    expect(src).toContain('setSelectedNode');
  });
  it('has zoom controls', () => {
    expect(src).toContain('ZoomIn');
    expect(src).toContain('ZoomOut');
  });
  it('calls graph/build endpoint', () => {
    expect(src).toContain('/api/graph/build');
  });
  it('has group color legend', () => {
    expect(src).toContain('GROUP_COLORS');
    expect(src).toContain('influencer');
  });
});
