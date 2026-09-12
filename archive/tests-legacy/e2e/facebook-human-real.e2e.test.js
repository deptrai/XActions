// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// Real Puppeteer E2E smoke test for Story 6.4 physics-eased mouse movement.
// by nichxbt
import { describe, it, expect } from 'vitest';
import puppeteer from 'puppeteer';
import { humanMoveMouse } from '../../src/scrapers/facebook/human.js';

const CHROME_PATH = await puppeteer.executablePath();

/**
 * Launch a headless browser with a stable viewport for deterministic mouse tests.
 */
async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
}

/**
 * Build a data URL page that records every mousemove event into window.mousePositions.
 */
function trackingPageUrl() {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Mouse Tracking</title></head>
      <body style="margin:0; width:1280px; height:720px;">
        <script>
          window.mousePositions = [];
          document.addEventListener('mousemove', (e) => {
            window.mousePositions.push({ x: e.clientX, y: e.clientY, t: performance.now() });
          });
        </script>
      </body>
    </html>
  `;
  return `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
}

describe('Story 6.4 — humanMoveMouse with real Puppeteer page', () => {
  it('moves the real mouse cursor to the target coordinate', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(trackingPageUrl(), { waitUntil: 'networkidle0' });

      await humanMoveMouse(page, 400, 300, { delayFn: async () => {}, rng: () => 0.5, startX: 0, startY: 0 });

      const positions = await page.evaluate(() => window.mousePositions);
      expect(positions.length).toBeGreaterThanOrEqual(20);

      const last = positions[positions.length - 1];
      expect(last.x).toBeCloseTo(400, 0);
      expect(last.y).toBeCloseTo(300, 0);
    } finally {
      await browser.close();
    }
  });

  it('produces slow-start / fast-coast / slow-end velocity profile', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(trackingPageUrl(), { waitUntil: 'networkidle0' });

      await humanMoveMouse(page, 800, 0, { delayFn: async () => {}, rng: () => 0.5, startX: 0, startY: 0 });

      const positions = await page.evaluate(() => window.mousePositions);
      expect(positions.length).toBeGreaterThanOrEqual(20);

      const distances = [Math.abs(positions[0].x - 0)];
      for (let i = 1; i < positions.length; i++) {
        distances.push(Math.abs(positions[i].x - positions[i - 1].x));
      }

      const first = distances[0];
      const last = distances[distances.length - 1];
      const mid = distances[Math.floor(distances.length / 2)];
      expect(first).toBeLessThan(mid);
      expect(last).toBeLessThan(mid);
    } finally {
      await browser.close();
    }
  });

  it('completes within 2 seconds with default delayFn (NFR1)', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(trackingPageUrl(), { waitUntil: 'networkidle0' });

      const started = Date.now();
      await humanMoveMouse(page, 600, 400, { rng: () => 0.5, startX: 100, startY: 100 });
      const elapsed = Date.now() - started;

      expect(elapsed).toBeLessThan(2000);
    } finally {
      await browser.close();
    }
  });
});
