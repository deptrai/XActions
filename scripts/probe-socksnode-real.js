// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { DynamicTunnelProvider } from '../src/proxy/providers.js';
import { fetch } from 'undici';

async function testSocksNode() {
  console.log('🚀 [SOCKSNODE REAL PROBE] Bắt đầu kiểm thử với Real Key...');
  const key = 'sk_08f7d8ad257b.w87tsc40H2P4vs1C0yOs2sqdtADpUuxp';
  const [user, pass] = key.split('.');

  console.log(`🔑 Key Format: User="${user}", Pass="${pass ? pass.slice(0, 5) + '...' : ''}"`);

  // Thử các gateway phổ biến của SocksNode (SocksNode thường dùng port 1080/8080/7777 hoặc gateway IP)
  const candidateGateways = [
    `http://${user}:${pass}@gate.socksnode.com:8080`,
    `socks5://${user}:${pass}@gate.socksnode.com:1080`,
    `http://${key}:x@gate.socksnode.com:8080`,
    `socks5://${key}:x@gate.socksnode.com:1080`,
    `http://${user}:${pass}@proxy.socksnode.com:8080`,
    `socks5://${user}:${pass}@proxy.socksnode.com:1080`,
    `http://${user}:${pass}@res.socksnode.com:8080`,
    `socks5://${user}:${pass}@res.socksnode.com:1080`,
  ];

  let success = false;

  for (const gw of candidateGateways) {
    console.log(`\n🌐 Đang thử gateway: ${gw.replace(/:[^:@]+@/, ':***@')} ...`);
    try {
      const provider = new DynamicTunnelProvider({
        gatewayUrl: gw,
        provider: 'socksnode',
        country: 'vn',
      });

      const proxy = provider.getProxy({ country: 'vn' });
      console.log(`   Generated Proxy Server: ${proxy.server}`);
      console.log(`   Generated Username: ${proxy.username}`);

      const agent = provider.getProxyAgent(proxy);
      console.log(`   Testing connection to https://httpbin.org/ip ...`);

      const res = await fetch('https://httpbin.org/ip', {
        dispatcher: agent,
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const body = await res.json();
        console.log(`   ✅ KẾT NỐI THÀNH CÔNG! External IP: ${body.origin}`);

        const geoRes = await fetch('https://ipinfo.io/json', {
          dispatcher: agent,
          signal: AbortSignal.timeout(8000),
        });
        if (geoRes.ok) {
          const geo = await geoRes.json();
          console.log(`   📍 Geo Location: ${geo.city || ''}, ${geo.region || ''}, ${geo.country || ''} (Org: ${geo.org || ''})`);
        }

        console.log('\n🎉 SOCKSNODE HOẠT ĐỘNG HOÀN HẢO QUA DYNAMICTUNNELPROVIDER!');
        success = true;
        break;
      } else {
        console.log(`   ⚠️ Gateway trả về HTTP ${res.status}`);
      }
    } catch (err) {
      console.log(`   ❌ Lỗi kết nối (${err.code || err.name}): ${err.message}`);
    }
  }

  if (!success) {
    console.log('\nℹ️ [INFO] Nếu SocksNode dùng hostname/port gateway đặc biệt (ví dụ gateway IP hoặc custom port 22225/3128), bạn có thể chỉ định chính xác domain/port gateway.');
  }
}

testSocksNode().catch(err => console.error('Probe error:', err));
