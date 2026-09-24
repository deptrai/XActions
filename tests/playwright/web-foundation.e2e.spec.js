// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Playwright E2E test for Story 48.1 Web Foundation & BFF.
 * Verifies Next.js 15 App Router loads, backend health check connects via BFF,
 * and Swagger UI link navigates to same-origin /api-docs/.
 */

import { test, expect } from '@playwright/test';

test.describe('Web Foundation & BFF Proxy E2E', () => {
  test('homepage loads and displays healthy backend status badge', async ({ page }) => {
    await page.goto('/');

    // Verify title and page header
    await expect(page.locator('h1')).toContainText('Social Intelligence & Automation Hub');

    // Verify BackendStatus component rendered
    const statusBadge = page.locator('text=Backend Live');
    await expect(statusBadge).toBeVisible({ timeout: 10000 });

    // Verify Swagger UI link points to same-origin /api-docs/ (no localhost:3001)
    const swaggerLink = page.locator('a:has-text("Swagger API Docs")').first();
    await expect(swaggerLink).toHaveAttribute('href', '/api-docs/');
  });

  test('same-origin BFF proxy forwards /api/health and returns envelope', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBe(true);

    const data = await res.json();
    expect(data).toHaveProperty('success', true);
  });
});
