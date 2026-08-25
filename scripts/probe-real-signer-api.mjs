// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { AbstractApiClient } from '../src/core/base-client.js';
import { PreSignedTokenRing, SignerWorkerPagePool } from '../src/core/signer-pool.js';
import { chromium } from 'playwright';

class RealTwitterHybridClient extends AbstractApiClient {
  name = 'real-twitter-hybrid';
  platform = 'twitter';
  requiresAuth = false;
}

async function main() {
  console.log('🚀 [PROBE] Starting Real API Test with Tiered Signer Engine (Story 13.1)...\n');

  // ==========================================
  // 1. TIER 1: PreSignedTokenRing (Real Twitter Guest Token)
  // ==========================================
  console.log('1️⃣ --- TIER 1: PreSignedTokenRing (Lấy Guest Token thật từ Twitter API) ---');
  const publicBearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  
  console.log('📡 [cURL Equivalent]:');
  console.log(`curl -X POST "https://api.twitter.com/1.1/guest/activate.json" \\
  -H "authorization: Bearer ${publicBearer}" \\
  -H "user-agent: Mozilla/5.0"\n`);

  console.log('🔄 Đang kích hoạt Guest Token thật từ Twitter...');
  const guestResp = await fetch('https://api.twitter.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${publicBearer}`,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  const guestData = await guestResp.json();
  console.log('✅ Kết quả JSON từ Twitter:', guestData);
  const realGuestToken = guestData.guest_token;

  const tokenRing = new PreSignedTokenRing({ capacity: 10 });
  tokenRing.refill([realGuestToken]);
  console.log(`📦 Token Ring đã nạp token vào RAM: size=${tokenRing.size}, capacity=${tokenRing.capacity}`);

  // ==========================================
  // 2. TIER 2: SignerWorkerPagePool (Real Headless Chromium)
  // ==========================================
  console.log('\n2️⃣ --- TIER 2: SignerWorkerPagePool (Khởi tạo Pool Worker Tabs thật) ---');
  console.log('🌐 Đang khởi động Headless Chromium...');
  const browser = await chromium.launch({ headless: true });
  
  const signerPool = new SignerWorkerPagePool({
    browser,
    minSize: 2,
    maxSize: 4,
  });

  await signerPool.init({
    warmupScript: `() => {
      window.__DEVICE_HASH__ = 'mac_dev_' + Math.random().toString(36).slice(2, 8);
      window.__SIGNER_VERSION__ = '13.1-hybrid';
    }`,
  });

  console.log(`✅ Signer Worker Pool sẵn sàng: activeCount=${signerPool.activeCount}, idleCount=${signerPool.idleCount}`);

  // ==========================================
  // 3. Khởi tạo Real Client
  // ==========================================
  const client = new RealTwitterHybridClient({
    tokenRing,
    signerPool,
  });

  // ==========================================
  // 4. TEST 1: Bắn requestWithSign() với Tier 1 TokenRing
  // ==========================================
  console.log('\n3️⃣ --- TEST 1: requestWithSign() bắn qua TokenRing (Gán Bearer & x-guest-token) ---');
  console.log('📡 Endpoint: https://httpbin.org/get');
  console.log(`📡 [cURL Equivalent]:
curl -X GET "https://httpbin.org/get" \\
  -H "authorization: Bearer ${publicBearer}" \\
  -H "x-guest-token: ${realGuestToken}"\n`);
  
  const res1 = await client.requestWithSign('GET', 'https://httpbin.org/get', {
    signType: 'token',
    location: 'header',
    name: 'x-guest-token',
  }, {
    headers: {
      'authorization': `Bearer ${publicBearer}`,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  console.log(`🎉 [HTTP Status: ${res1.status}] Kết quả Upstream nhận được từ requestWithSign (Tier 1):`);
  console.log({
    status: res1.status,
    guest_token_received_by_server: res1.data?.headers?.['X-Guest-Token'],
    auth_received_by_server: res1.data?.headers?.['Authorization']?.slice(0, 30) + '...',
  });

  // ==========================================
  // 5. TEST 2: Dynamic JS Signature trên Browser Tab + HTTP Request
  // ==========================================
  console.log('\n4️⃣ --- TEST 2: requestWithSign() tính Dynamic Signature trên Browser Tab thật ---');
  console.log('📡 Đang gửi script tính toán chữ ký động qua SignerWorkerPagePool...');
  
  const res2 = await client.requestWithSign('POST', 'https://httpbin.org/post', {
    signType: 'page',
    script: (txQueryId) => {
      const timestamp = Date.now();
      const raw = txQueryId + ':' + timestamp + ':' + window.__DEVICE_HASH__;
      return {
        headers: {
          'x-client-transaction-id': btoa(raw),
          'x-client-timestamp': String(timestamp),
          'x-signer-ver': window.__SIGNER_VERSION__,
        },
        query: {
          signed_ver: '2.0',
        }
      };
    },
    args: ['SearchTimeline_QueryId_98765'],
  }, {
    json: { query: 'cryptocurrency', limit: 20 },
    headers: {
      'authorization': `Bearer ${publicBearer}`,
    }
  });

  console.log(`🎉 [HTTP Status: ${res2.status}] Server Upstream nhận được Request đã ký:`);
  console.log({
    received_url: res2.data?.url,
    headers_received_by_httpbin: res2.data?.headers,
    received_body: res2.data?.json,
  });

  // ==========================================
  // 6. Dọn dẹp tài nguyên
  // ==========================================
  console.log('\n🧹 Đang đóng SignerWorkerPagePool và Browser...');
  await signerPool.close();
  await browser.close();
  console.log('✅ Hoàn thành 100% kiểm thử Real API với Story 13.1 Tiered Signer Engine!');
}

main().catch((err) => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
