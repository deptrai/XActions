// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import https from 'node:https';
import http from 'node:http';

async function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      ...headers
    };

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(url, { headers: defaultHeaders, timeout: 10000 }, (res) => {
      let data = '';
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
        }
        return fetchUrl(redirectUrl, headers).then(resolve).catch(reject);
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function runProbes() {
  console.log('--- 🧪 PROBING REAL ENDPOINTS FOR NEW DOMAINS ---');

  // 1. Domain 1: B2B - MaSoThue (Company Registry)
  try {
    const res = await fetchUrl('https://masothue.com/tra-cuu-ma-so-thue-theo-tinh/ha-noi-1');
    console.log(`\n[1] MaSoThue (Hà Nội Company List): Status ${res.statusCode}, Body size: ${res.body.length} bytes`);
    const hasTaxList = res.body.includes('tax-listing') || res.body.includes('Mã số thuế') || res.body.includes('công ty');
    console.log(`    ✅ Match Company/Tax elements: ${hasTaxList}`);
  } catch (err) {
    console.error('    ❌ MaSoThue Probe failed:', err.message);
  }

  // 2. Domain 2: Automotive - Bonbanh
  try {
    const res = await fetchUrl('https://bonbanh.com/oto');
    console.log(`\n[2] BonBanh (Automotive Listings): Status ${res.statusCode}, Body size: ${res.body.length} bytes`);
    const hasCarList = res.body.includes('car-item') || res.body.includes('menu_brand') || res.body.includes('oto');
    console.log(`    ✅ Match Automotive elements: ${hasCarList}`);
  } catch (err) {
    console.error('    ❌ BonBanh Probe failed:', err.message);
  }

  // 3. Domain 3: F&B - PasGo
  try {
    const res = await fetchUrl('https://pasgo.vn/ha-noi/nha-hang');
    console.log(`\n[3] PasGo (Restaurant Directory): Status ${res.statusCode}, Body size: ${res.body.length} bytes`);
    const hasRestaurant = res.body.includes('nha-hang') || res.body.includes('restaurant') || res.body.includes('PasGo');
    console.log(`    ✅ Match F&B Restaurant elements: ${hasRestaurant}`);
  } catch (err) {
    console.error('    ❌ PasGo Probe failed:', err.message);
  }

  // 4. Domain 4: Healthcare - YouMed
  try {
    const res = await fetchUrl('https://youmed.vn/dat-kham/bac-si');
    console.log(`\n[4] YouMed (Doctor & Clinic Directory): Status ${res.statusCode}, Body size: ${res.body.length} bytes`);
    const hasDoctor = res.body.includes('bác sĩ') || res.body.includes('doctor') || res.body.includes('YouMed');
    console.log(`    ✅ Match Healthcare elements: ${hasDoctor}`);
  } catch (err) {
    console.error('    ❌ YouMed Probe failed:', err.message);
  }

  console.log('\n--- 🏁 PROBE COMPLETE ---');
}

runProbes();
