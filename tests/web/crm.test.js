// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 47.3 — Follower CRM & Contact Intelligence screen tests.
 *
 * Verifies that:
 *   - apps/web/app/crm/page.tsx exists and defines FollowerCrmPage
 *   - Contacts table displays Lead Scores and segments
 *   - Tag addition interacts with /api/crm/tag
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'crm', 'page.tsx');

describe('Story 47.3 — Follower CRM & Contact Intelligence Screen', () => {
  it('crm page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page defines contacts with lead score and tags', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('INITIAL_CONTACTS');
    expect(src).toContain('leadScore');
    expect(src).toContain('tags');
    expect(src).toContain('Lead Score');
  });

  it('page provides segment filters', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('VIPs (Score ≥ 80)');
    expect(src).toContain('Founders');
    expect(src).toContain('AI Builders');
  });

  it('page supports adding tags and posts to /api/crm/tag', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('handleAddTag');
    expect(src).toContain('http://localhost:3001/api/crm/tag');
  });
});
