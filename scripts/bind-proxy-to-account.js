// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../api/lib/prisma.js';
import { encrypt } from '../api/routes/facebookAccounts.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function updateProxyForAccount() {
  console.log('🔄 [DB UPDATE] Đang cập nhật Proxy SocksNode vào Facebook Account...');

  // Thông tin proxy từ API SocksNode
  const proxyUrl = 'http://snkidcjf24qjp5@sg.premium.socksnode.com:9000';
  const encryptedProxy = encrypt(proxyUrl);

  const updated = await prisma.facebookAccount.updateMany({
    data: {
      encryptedProxy: encryptedProxy,
    }
  });

  console.log(`✅ Đã cập nhật encryptedProxy cho ${updated.count} Facebook Account trong Database!`);

  // Lưu cấu hình proxy vào ~/.xactions/proxy-config.json để CLI và Crawler tự động dùng
  const xactionsDir = path.join(os.homedir(), '.xactions');
  if (!fs.existsSync(xactionsDir)) {
    fs.mkdirSync(xactionsDir, { recursive: true });
  }

  const proxyConfig = {
    provider: 'socksnode',
    gatewayUrl: proxyUrl,
    host: 'sg.premium.socksnode.com',
    port: 9000,
    username: 'snkidcjf24qjp5',
    product: 'residential',
    country: 'vn',
    apiKey: 'sk_08f7d8ad257b.w87tsc40H2P4vs1C0yOs2sqdtADpUuxp',
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(xactionsDir, 'proxy-config.json'), JSON.stringify(proxyConfig, null, 2));
  console.log(`✅ Đã lưu cấu hình proxy vào ${path.join(xactionsDir, 'proxy-config.json')}`);

  const accounts = await prisma.facebookAccount.findMany({
    select: {
      id: true,
      label: true,
      encryptedProxy: true,
    }
  });
  console.log('📋 Danh sách Account hiện tại trong DB:');
  for (const acc of accounts) {
    console.log(`   - ID: ${acc.id} | Label: ${acc.label} | HasProxy: ${Boolean(acc.encryptedProxy)}`);
  }
}

updateProxyForAccount()
  .catch(err => console.error('❌ Lỗi update proxy:', err))
  .finally(() => prisma.$disconnect());
