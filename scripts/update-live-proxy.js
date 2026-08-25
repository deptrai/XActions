// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../api/lib/prisma.js';
import { encrypt } from '../api/routes/facebookAccounts.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function updateLiveProxy() {
  const proxyUrl = 'http://snkidcjf24qjp5-country-vn:24c7170b-095d-47f4-a7c9-3e936af7af45@premium.socksnode.com:9000';
  const encryptedProxy = encrypt(proxyUrl);

  const updated = await prisma.facebookAccount.updateMany({
    data: {
      encryptedProxy,
    }
  });

  console.log(`✅ Đã cập nhật live residential proxy (VNPT HCMC) cho ${updated.count} Facebook Account trong Database!`);

  const xactionsDir = path.join(os.homedir(), '.xactions');
  const proxyConfig = {
    provider: 'socksnode',
    gatewayUrl: proxyUrl,
    host: 'premium.socksnode.com',
    port: 9000,
    username: 'snkidcjf24qjp5-country-vn',
    password: '24c7170b-095d-47f4-a7c9-3e936af7af45',
    product: 'residential',
    country: 'vn',
    isp: 'VNPT Corp',
    city: 'Ho Chi Minh City',
    apiKey: 'sk_08f7d8ad257b.w87tsc40H2P4vs1C0yOs2sqdtADpUuxp',
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(xactionsDir, 'proxy-config.json'), JSON.stringify(proxyConfig, null, 2));
  console.log(`✅ Đã đồng bộ cấu hình vào ${path.join(xactionsDir, 'proxy-config.json')}`);
}

updateLiveProxy()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
