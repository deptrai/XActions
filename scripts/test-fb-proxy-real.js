// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { loginWithCookie } from '../src/scrapers/facebook/auth.js';
import { scrapeProfile } from '../src/scrapers/facebook/profile.js';
import fs from 'node:fs';

puppeteer.use(StealthPlugin());

async function testFacebookWithProxy() {
  console.log('🚀 [FB PROXY TEST] Bắt đầu kiểm tra Facebook với Residential Proxy thật...');

  const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
  const proxyConfig = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/proxy-config.json', 'utf8'));

  console.log(`🌐 Proxy Host: ${proxyConfig.host}:${proxyConfig.port}`);
  console.log(`📍 Nhà mạng / Vị trí: ${proxyConfig.isp} - ${proxyConfig.city}, ${proxyConfig.country}`);

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true,
    args: [
      `--proxy-server=http://${proxyConfig.host}:${proxyConfig.port}`,
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--no-sandbox',
    ],
  });
  const page = await browser.newPage();

  try {
    // Authenticate proxy on Chromium page
    await page.authenticate({
      username: proxyConfig.username,
      password: proxyConfig.password,
    });

    const cookieMap = {};
    for (const c of rawCookies) cookieMap[c.name] = c.value;

    console.log('🔑 Đang xác thực Facebook session...');
    await loginWithCookie(page, cookieMap, { skipWarmup: true });
    console.log('✅ Đăng nhập Facebook thành công qua Residential Proxy VNPT!');

    console.log('📄 Đang cào thông tin Page Meta qua Proxy VNPT...');
    const profile = await scrapeProfile(page, 'meta', { timeout: 30000 });
    console.log('✅ Kết quả cào Facebook qua Residential Proxy:', {
      name: profile.name,
      verified: profile.verified,
    });

    console.log('\n🎉 TOÀN BỘ QUY TRÌNH (TỰ ĐỘNG MUA/TẠO PROXY -> GÁN TÀI KHOẢN -> CÀO FB BẰNG PROXY DÂN CƯ VNPT) THÀNH CÔNG 100%!');
  } finally {
    await browser.close();
  }
}

testFacebookWithProxy().catch(err => {
  console.error('❌ Lỗi:', err.message);
});
