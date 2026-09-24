// by nichxbt — tests/web/video.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/video/page.tsx'), 'utf8');

describe('video page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
});

describe('video page specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/video/page.tsx'), 'utf8');
  it('has URL input', () => {
    expect(src).toContain('x.com/user/status');
  });
  it('has quality selection', () => {
    expect(src).toContain('1080p');
    expect(src).toContain('720p');
  });
  it('has download handler', () => {
    expect(src).toContain('handleDownload');
    expect(src).toContain('blob');
  });
});
