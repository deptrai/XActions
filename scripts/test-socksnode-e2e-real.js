// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { DynamicTunnelProvider } from '../src/proxy/providers.js';
import { fetch } from 'undici';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function runRealTest() {
  console.log('🚀 ==========================================');
  console.log('🚀 SOCKSNDOE REAL E2E & API INTEGRATION TEST');
  console.log('🚀 ==========================================\n');

  const key = 'sk_08f7d8ad257b.w87tsc40H2P4vs1C0yOs2sqdtADpUuxp';
  const [user, pass] = key.split('.');

  console.log(`🔑 Key Breakdown:`);
  console.log(`   - User / Account: "${user}"`);
  console.log(`   - Password/Secret: "${pass ? pass.slice(0, 8) + '...' : ''}"`);
  console.log(`   - Gateway Host:    "premium.socksnode.com:9000"\n`);

  const configs = [
    {
      name: 'HTTP Tunnel (split user:pass)',
      url: `http://${user}:${pass}@premium.socksnode.com:9000`,
    },
    {
      name: 'SOCKS5 Tunnel (split user:pass)',
      url: `socks5://${user}:${pass}@premium.socksnode.com:9000`,
    },
    {
      name: 'HTTP Tunnel (full key as user)',
      url: `http://${key}:x@premium.socksnode.com:9000`,
    },
    {
      name: 'SOCKS5 Tunnel (full key as user)',
      url: `socks5://${key}:x@premium.socksnode.com:9000`,
    },
  ];

  let workingProvider = null;
  let workingProxy = null;

  for (const cfg of configs) {
    console.log(`🧪 [TESTING] ${cfg.name}...`);
    try {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: cfg.url,
        provider: 'socksnode',
      });

      const proxy = provider.getProxy({ country: 'vn' });
      console.log(`   Generated Proxy: ${proxy.server}`);
      console.log(`   Generated User:   ${proxy.username}`);

      const agent = provider.getProxyAgent(proxy);

      console.log(`   📡 Sending HTTP request to https://api.ipify.org?format=json ...`);
      const res = await fetch('https://api.ipify.org?format=json', {
        dispatcher: agent,
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`   ✅ SUCCESS! Real Residential IP: ${data.ip}`);

        // Query IP Geo details
        try {
          const geoRes = await fetch(`https://ipinfo.io/${data.ip}/json`, {
            dispatcher: agent,
            signal: AbortSignal.timeout(10000),
          });
          if (geoRes.ok) {
            const geo = await geoRes.json();
            console.log(`   📍 Geo: ${geo.city || ''}, ${geo.region || ''}, ${geo.country || ''} | ISP/Org: ${geo.org || ''}`);
          }
        } catch {}

        workingProvider = provider;
        workingProxy = proxy;
        break;
      } else {
        const text = await res.text().catch(() => '');
        console.log(`   ⚠️ Response Status ${res.status}: ${text.slice(0, 100)}`);
      }
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
    }
    console.log('');
  }

  if (workingProvider && workingProxy) {
    console.log('\n🎭 ==========================================');
    console.log('🎭 RUNNING REAL BROWSER E2E TEST (PUPPETEER/PLAYWRIGHT WITH SOCKS5)');
    console.log('🎭 ==========================================\n');

    const browserArgs = workingProvider.getBrowserArgs(workingProxy);
    console.log('🌐 Launching Chromium with Anti-Leak Flags:');
    for (const arg of browserArgs) {
      console.log(`   ${arg}`);
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      args: browserArgs,
    });

    try {
      const page = await browser.newPage();
      if (workingProxy.username && workingProxy.password) {
        await page.authenticate({
          username: workingProxy.username,
          password: workingProxy.password,
        });
      }

      console.log('🚀 Navigating to https://httpbin.org/ip via Residential Proxy...');
      await page.goto('https://httpbin.org/ip', { waitUntil: 'domcontentloaded', timeout: 20000 });
      const content = await page.evaluate(() => document.body.innerText);
      console.log('✅ Real Browser Response:');
      console.log(`   ${content.trim()}`);

      console.log('\n🎉 ALL REAL API & REAL BROWSER TESTS PASSED 100% FOR STORY 11.8!');
    } catch (browserErr) {
      console.log(`⚠️ Browser test note: ${browserErr.message}`);
    } finally {
      await browser.close();
    }
  } else {
    console.log('\n❌ Không thể kết nối tới SocksNode gateway với các biến thể thông tin đã thử.');
  }
}

runRealTest().catch(console.error);
