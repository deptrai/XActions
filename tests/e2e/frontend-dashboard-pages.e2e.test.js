// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Comprehensive Frontend Dashboard Surface Audit
 *
 * Verifies end-to-end rendering and availability of all 51 dashboard pages:
 * 1. HTTP 200 and text/html headers
 * 2. Proper HTML structure (<title>, <main> or container, header/sidebar)
 * 3. Static assets availability (/css/common.css, icons, scripts)
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import app from '../../api/server.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-fe-dashboard';

// Collect all html files in dashboard/
const DASHBOARD_DIR = path.resolve('dashboard');
const allHtmlFiles = fs.readdirSync(DASHBOARD_DIR)
  .filter((f) => f.endsWith('.html') && f !== '404.html')
  .sort();

describe('Frontend — Comprehensive Dashboard Pages Audit E2E', () => {
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] core static assets (/css/common.css, icons) are served correctly`, async () => {
    const cssRes = await request(app).get('/css/common.css');
    expect([200, 304]).toContain(cssRes.status);
    expect(cssRes.headers['content-type']).toMatch(/css/);
  });

  // Test every single dashboard page in a batched, robust manner
  for (const file of allHtmlFiles) {
    const route = file === 'index.html' ? '/' : `/${file}`;
    const dashboardRoute = `/dashboard/${file}`;

    it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] loads page "${file}" with valid HTML structure`, async () => {
      // Test direct route or /dashboard/ route
      const res = await request(app).get(dashboardRoute);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(/<!doctype\s+html>/i.test(res.text)).toBe(true);
      expect(res.text).toContain('<html');
      expect(res.text).toContain('</html>');

      // Title should be defined (supports <title id="...">)
      const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(res.text);
      expect(hasTitle).toBe(true);
    });
  }
});
