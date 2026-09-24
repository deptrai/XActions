// by nichxbt — tests/web/workflows.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../apps/web/app/workflows/page.tsx'), 'utf8');

describe('workflows page', () => {
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

describe('workflows page specifics', () => {
  const src = readFileSync(join(__dirname, '../../apps/web/app/workflows/page.tsx'), 'utf8');
  it('has step types', () => {
    expect(src).toContain('STEP_TYPES');
    expect(src).toContain('scrape');
  });
  it('has trigger types', () => {
    expect(src).toContain('TRIGGER_TYPES');
    expect(src).toContain('cron');
  });
  it('has add/remove step', () => {
    expect(src).toContain('addStep');
    expect(src).toContain('removeStep');
  });
  it('calls workflows endpoint', () => {
    expect(src).toContain('/api/workflows');
  });
});
