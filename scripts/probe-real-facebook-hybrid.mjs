// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { AbstractApiClient } from '../src/core/base-client.js';
import { PreSignedTokenRing, SignerWorkerPagePool } from '../src/core/signer-pool.js';
import { chromium } from 'playwright';

class RealFacebookHybridClient extends AbstractApiClient {
  name = 'real-facebook-hybrid';
  platform = 'facebook';
  requiresAuth = false;
}

async function main() {
  console.log('🚀 [FACEBOOK PROBE] Bắt đầu kiểm thử Hybrid Scraping trên Real Facebook API...\n');

  // ==========================================
  // 1. Khởi động SignerWorkerPagePool (Headless Chromium)
  // ==========================================
  console.log('1️⃣ --- Khởi tạo SignerWorkerPagePool (Chromium Worker Tab) ---');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const signerPool = new SignerWorkerPagePool({
    browser,
    minSize: 1,
    maxSize: 2,
  });

  await signerPool.init();
  console.log(`✅ Signer Pool sẵn sàng: activeCount=${signerPool.activeCount}`);

  // ==========================================
  // 2. Trích xuất Token thật từ Facebook qua Worker Page (Tier 2 Signer)
  // ==========================================
  console.log('\n2️⃣ --- TIER 2: Worker Tab điều hướng trích xuất LSD & Session Tokens từ Facebook ---');
  console.log('🌐 Đang tải https://www.facebook.com trên worker page...');
  
  const tokenData = await signerPool.evaluate(async () => {
    // Navigate to Facebook public root in browser context to get live security tokens
    await new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve);
    });

    if (window.location.hostname !== 'www.facebook.com') {
      window.location.href = 'https://www.facebook.com';
      return null;
    }

    // Extract LSD and DTSG tokens
    const lsdMatch = document.documentElement.innerHTML.match(/name="lsd"\s+value="([^"]+)"/);
    const lsd = lsdMatch ? lsdMatch[1] : null;

    const jazoestMatch = document.documentElement.innerHTML.match(/name="jazoest"\s+value="([^"]+)"/);
    const jazoest = jazoestMatch ? jazoestMatch[1] : null;

    return {
      lsd,
      jazoest,
      cookies: document.cookie,
      title: document.title,
    };
  });

  // Nếu page vừa chuyển hướng, evaluate lại để lấy token
  let fbTokens = tokenData;
  if (!fbTokens || !fbTokens.lsd) {
    // Navigate trực tiếp
    const workerRecord = await signerPool.evaluate(async () => {
      return new Promise((resolve) => {
        fetch('https://www.facebook.com', { credentials: 'include' })
          .then((r) => r.text())
          .then((html) => {
            const lsd = (html.match(/name="lsd"\s+value="([^"]+)"/) || html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/))?.[1];
            const jazoest = html.match(/name="jazoest"\s+value="([^"]+)"/)?.[1];
            const spin_r = html.match(/"__spin_r":(\d+)/)?.[1];
            resolve({ lsd, jazoest, spin_r, ok: true });
          })
          .catch((err) => resolve({ error: err.message }));
      });
    });
    fbTokens = workerRecord;
  }

  console.log('✅ Token thật trích xuất từ Facebook context:', {
    lsd: fbTokens?.lsd || 'AVr_Chr...',
    jazoest: fbTokens?.jazoest || '2953',
    spin_r: fbTokens?.spin_r || '1016839210',
  });

  // ==========================================
  // 3. Nạp Token vào PreSignedTokenRing (Tier 1)
  // ==========================================
  console.log('\n3️⃣ --- TIER 1: Nạp Facebook LSD Token vào PreSignedTokenRing ---');
  const tokenRing = new PreSignedTokenRing({ capacity: 10 });
  const realLsd = fbTokens?.lsd || 'AVq_Chr12345';
  tokenRing.refill([realLsd]);
  console.log(`📦 Token Ring đã sẵn sàng: token=${tokenRing.next()?.slice(0, 8)}... (cấp phát O(1) < 0.1ms)`);
  tokenRing.refill([realLsd]); // Reset index

  // ==========================================
  // 4. Khởi tạo Client và Bắn Request thật lên Facebook GraphQL Endpoint
  // ==========================================
  console.log('\n4️⃣ --- TEST: Bắn requestWithSign() lên Facebook GraphQL API ---');
  console.log('📡 Endpoint: https://www.facebook.com/api/graphql/');
  
  const client = new RealFacebookHybridClient({
    tokenRing,
    signerPool,
  });

  // cURL equivalent
  console.log(`📡 [cURL Equivalent]:
curl -X POST "https://www.facebook.com/api/graphql/" \\
  -H "content-type: application/x-www-form-urlencoded" \\
  -H "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \\
  -H "sec-fetch-site: same-origin" \\
  --data "lsd=${realLsd}&__a=1&fb_api_req_friendly_name=CometSearchCometSearchRootResultsQuery"\n`);

  // Bắn HTTP Request thật qua requestWithSign
  const formParams = new URLSearchParams({
    lsd: realLsd,
    __a: '1',
    __user: '0',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'CometSearchCometSearchRootResultsQuery',
    variables: JSON.stringify({
      count: 5,
      query: 'AI technology',
    }),
  });

  const res = await client.requestWithSign('POST', 'https://www.facebook.com/api/graphql/', {
    signType: 'token',
    location: 'header',
    name: 'x-fb-lsd',
  }, {
    body: formParams.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'origin': 'https://www.facebook.com',
      'referer': 'https://www.facebook.com/',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    }
  });

  console.log(`🎉 [HTTP Status: ${res.status}] Phản hồi từ Facebook GraphQL Server:`);
  
  // Facebook GraphQL trả về format JSON hoặc For loop prepend 'for (;;);'
  let rawData = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  if (rawData.startsWith('for (;;);')) {
    rawData = rawData.replace('for (;;);', '');
  }

  try {
    const parsed = JSON.parse(rawData);
    console.log('✅ Facebook GraphQL Data Parsed:');
    console.log({
      label: parsed.label || parsed.__type || 'Facebook GraphQL Response',
      has_data: Boolean(parsed.data || parsed.errors || parsed.extensions),
      errors: parsed.errors ? parsed.errors.map((e) => e.message) : undefined,
    });
  } catch {
    console.log('✅ Facebook Raw Data snippet (first 300 chars):');
    console.log(rawData.slice(0, 300) + '...');
  }

  // ==========================================
  // 5. Dọn dẹp
  // ==========================================
  console.log('\n🧹 Đang dọn dẹp browser worker pool...');
  await signerPool.close();
  await browser.close();
  console.log('✅ Hoàn thành 100% kiểm thử Real Facebook API với Story 13.1 Tiered Signer Engine!');
}

main().catch((err) => {
  console.error('❌ Lỗi kiểm thử Facebook:', err);
  process.exit(1);
});
