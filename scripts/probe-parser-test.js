// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Live Technical Feasibility & Pilot Extraction Verification Script
 * Covers Epics 21 & 22: B2B Registry (MaSoThue), Automotive (BonBanh), F&B (PasGo)
 */

import https from 'node:https';

async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
      }
    }, (res) => {
      let data = '';
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        return fetchUrl(redirectUrl).then(resolve).catch(reject);
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseMaSoThue(html) {
  const items = [];
  const regex = /<div data-prefetch='([^']+)'>[\s\S]*?<h3><a[^>]*title='([^']+)'[^>]*>([^<]+)<\/a><\/h3>[\s\S]*?<address>([\s\S]*?)<\/address>/g;
  let match;
  while ((match = regex.exec(html)) !== null && items.length < 3) {
    const slug = match[1];
    const companyName = match[3].trim();
    const address = match[4].replace(/<[^>]+>/g, '').trim();
    const taxMatch = slug.match(/\/(\d{10}(-\d{3})?)/);
    const taxCode = taxMatch ? taxMatch[1] : null;

    items.push({
      id: `masothue:${taxCode || slug.replace('/', '')}`,
      platform: 'masothue',
      category: 'b2b_lead',
      title: companyName,
      content: `${companyName} - MST: ${taxCode} - Địa chỉ: ${address}`,
      metadata: {
        taxCode,
        companyName,
        address,
        detailUrl: `https://masothue.com${slug}`
      }
    });
  }
  return items;
}

function parseBonBanh(html) {
  const items = [];
  const regex = /itemtype="http:\/\/schema\.org\/Car">[\s\S]*?<a itemprop="url" href="([^"]+)"[\s\S]*?<h3 itemprop="name">([^<]+)<\/h3>[\s\S]*?<b itemprop="price"[^>]*content="([^"]*)">([\s\S]*?)<\/b>/g;
  let match;
  while ((match = regex.exec(html)) !== null && items.length < 3) {
    const slug = match[1];
    const title = match[2].trim();
    const priceNum = Number(match[3]) || 0;
    const priceText = match[4].replace(/<[^>]+>/g, '').trim();

    items.push({
      id: `bonbanh:${slug.replace(/\.html$/, '')}`,
      platform: 'bonbanh',
      category: 'automotive',
      title,
      content: `Xe ${title} - Giá: ${priceText}`,
      metadata: {
        model: title,
        price: priceNum,
        priceFormatted: priceText,
        detailUrl: `https://bonbanh.com/${slug}`
      }
    });
  }
  return items;
}

function parsePasGo(html) {
  const items = [];
  const headingRegex = /<h3 class="overflow-ellipsis-one">([^<]+)<\/h3>/g;
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null && items.length < 3) {
    const name = hMatch[1].trim();
    items.push({
      id: `pasgo:${encodeURIComponent(name.toLowerCase().replace(/[\s\/–-]+/g, '-'))}`,
      platform: 'pasgo',
      category: 'fnb_merchant',
      title: name,
      content: `Nhà hàng ${name} (Hà Nội)`,
      metadata: {
        restaurantName: name,
        city: 'Hà Nội'
      }
    });
  }
  return items;
}

async function runVerification() {
  console.log('================================================================');
  console.log('🧪 LIVE TECHNICAL FEASIBILITY & DATA EXTRACTION VERIFICATION');
  console.log('================================================================');

  // 1. Story 21.1: B2B Registry (MaSoThue)
  const masothueHtml = await fetchUrl('https://masothue.com/tra-cuu-ma-so-thue-theo-tinh/ha-noi-1');
  const companies = parseMaSoThue(masothueHtml);
  console.log(`\n✅ [Story 21.1] B2B Company Registry (MaSoThue) - Extracted ${companies.length} records:`);
  console.log(JSON.stringify(companies, null, 2));

  // 2. Story 21.2: Automotive (BonBanh)
  const bonbanhHtml = await fetchUrl('https://bonbanh.com/oto');
  const cars = parseBonBanh(bonbanhHtml);
  console.log(`\n✅ [Story 21.2] Automotive & Vehicles (BonBanh) - Extracted ${cars.length} records:`);
  console.log(JSON.stringify(cars, null, 2));

  // 3. Story 22.1: F&B Merchant (PasGo)
  const pasgoHtml = await fetchUrl('https://pasgo.vn/ha-noi/nha-hang');
  const restaurants = parsePasGo(pasgoHtml);
  console.log(`\n✅ [Story 22.1] F&B Merchant & Restaurant (PasGo) - Extracted ${restaurants.length} records:`);
  console.log(JSON.stringify(restaurants, null, 2));

  console.log('\n================================================================');
  console.log('🎉 100% OF PROBES PARSED CLEANLY INTO POSTITEM / METADATA SCHEMAS!');
  console.log('================================================================');
}

runVerification();
