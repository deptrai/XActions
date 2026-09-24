// by nichxbt — tests/web/thread-composer.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/thread-composer/page.tsx'), 'utf8');

describe('thread-composer page', () => {
  it('is a client component', () => {
    expect(src).toContain("'use client'");
  });
  it('imports api helper', () => {
    expect(src).toContain("from '@/lib/api'");
  });
});

describe('thread-composer specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/thread-composer/page.tsx'), 'utf8');
  it('has char count', () => {
    expect(src).toContain('charCount');
    expect(src).toContain('MAX_CHARS');
  });
  it('has add/remove tweet', () => {
    expect(src).toContain('addTweet');
    expect(src).toContain('removeTweet');
  });
  it('has preview mode', () => {
    expect(src).toContain('previewMode');
  });
});
