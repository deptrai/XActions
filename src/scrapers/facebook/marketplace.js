// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper — marketplace.js
import { randomDelay } from './core.js';
import { buildMarketplaceSearchUrl, normalizeMarketplaceListing } from './normalize.js';


/**
 * Scrape Facebook Marketplace listings by search query or category.
 *
 * @param {import('puppeteer').Page} page - Puppeteer page (authenticated)
 * @param {string} query - Search query (e.g. "iphone 15") or category path
 * @param {FacebookOptions} [options]
 * @returns {Promise<unknown[]>} Array of normalized marketplace listings
 */
export async function scrapeMarketplace(page, query, options = {}) {
  const {
    limit = 50,
    location,
    minPrice,
    maxPrice,
    category,
    onProgress,
    delay = randomDelay,
  } = options;

  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('❌ Marketplace search requires a non-empty query string');
  }

  const searchUrl = buildMarketplaceSearchUrl(query, { location, category, minPrice, maxPrice });

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await delay(3000, 5000);

  const finalUrl = page.url();
  if (finalUrl.includes('/checkpoint/')) {
    throw new Error('❌ Facebook checkpoint detected — manual verification required. Log in to the account via a real browser, complete the security check, then retry.');
  }

  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/marketplace/item/"], a[href*="/marketplace/listing/"]').length > 0,
      { timeout: 20000 },
    );
  } catch (_) {
    // Proceed — may still extract if cards load late or page has none.
  }

  const listings = new Map();
  let stalls = 0;
  const maxStalls = 8;

  while (listings.size < limit && stalls < maxStalls) {
    const prevSize = listings.size;

    const rawListings = await page.evaluate((evalLimit) => {
      const results = [];
      const cards = [...document.querySelectorAll('a[href*="/marketplace/item/"], a[href*="/marketplace/listing/"]')];

      for (const card of cards) {
        const href = card.getAttribute('href') || '';
        if (!href.includes('marketplace/')) continue;

        const cleanHref = href.split('?')[0];
        const id = cleanHref.split('/').filter(Boolean).pop() || '';
        if (!id || /[^0-9]/.test(id)) continue;

        const listingUrl = cleanHref.startsWith('http') ? cleanHref : `https://www.facebook.com${cleanHref}`;

        const imgEl = card.querySelector('img');
        const image = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;

        let title = null;
        let price = null;
        let cardLocation = null;

        const ariaLabel = card.getAttribute('aria-label')?.trim() || '';
        if (ariaLabel) {
          const m = ariaLabel.match(/^(.*),\s*(Free|(?:[A-Z]{0,3}[₫$€£¥₹₩]\s*[\d,\.]+(?:\s*(?:USD|EUR|VND|ETB|VNĐ))?)|(?:[A-Z]{2,5}\s*[\d,\.]+(?:\s*(?:USD|EUR|VND|ETB|VNĐ))?))\s*,\s*(.+?)\s*,\s*listing\s+(\d+)$/is);
          if (m) {
            title = m[1].trim().replace(/\s+/g, ' ');
            price = m[2].trim().replace(/\s+/g, ' ');
            cardLocation = m[3].trim().replace(/\s+/g, ' ');
          }
        }

        if (!title) {
          const allText = card.textContent?.trim() || '';
          const priceMatch = allText.match(/^(?:\s*Free\s*|[\$€£¥₹₫₩A-Z]*\s*[\d,]+(?:\.\d{2})?(?:\s*(?:USD|EUR|VND|ETB|VNĐ))?)/i);
          if (priceMatch) {
            price = priceMatch[0].trim().replace(/\s+/g, ' ');
            const after = allText.substring(priceMatch[0].length).trim().replace(/\+/g, ' ').replace(/\s+/g, ' ');
            const locationMatch = after.match(/(.+?)(?:\s*,\s*)?(Ho Chi Minh City(?:, Vietnam)?|Hanoi(?:, Vietnam)?|Da Nang(?:, Vietnam)?)$/i);
            if (locationMatch) {
              title = locationMatch[1].trim();
              cardLocation = locationMatch[2].trim();
            } else {
              title = after;
            }
          } else {
            title = allText;
          }
        }

        if (title || price) {
          results.push({ id, title, price, location: cardLocation, image, listingUrl });
          if (results.length >= evalLimit) break;
        }
      }

      return results;
    }, limit);

    for (const raw of rawListings) {
      if (!listings.has(raw.id)) {
        listings.set(raw.id, normalizeMarketplaceListing(raw));
      }
      if (listings.size >= limit) break;
    }

    if (onProgress) onProgress({ scraped: listings.size, limit });

    if (listings.size === prevSize) {
      stalls++;
    } else {
      stalls = 0;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
  }

  return Array.from(listings.values()).slice(0, limit);
}
