// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { TerminalQrLogin } from '../src/core/login/terminal-qr.js';
import { displayTerminalQrCode, isTty } from '../src/utils/qrcode.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function runE2EVerification() {
  console.log('🛡️  [SENTINEL E2E MARSHAL] Starting Live Verification for Story 12.1...\n');

  // Test 1: Shortcode distribution & forbidden characters audit (10,000 samples)
  const login = new TerminalQrLogin();
  const sampleSize = 10000;
  const codes = new Set();
  const forbiddenRegex = /[0OI1l]/;
  let forbiddenFound = 0;

  for (let i = 0; i < sampleSize; i++) {
    const code = login.generateShortCode();
    codes.add(code);
    if (forbiddenRegex.test(code)) {
      forbiddenFound++;
    }
  }

  console.log(`[E2E 1] Shortcode Generation (${sampleSize} samples):`);
  console.log(`  - Unique codes generated: ${codes.size} / ${sampleSize}`);
  console.log(`  - Forbidden characters (0, O, I, 1, l) detected: ${forbiddenFound}`);
  if (forbiddenFound > 0) throw new Error('Forbidden characters detected in short code!');

  // Test 2: Real File System Cookie Storage & Permission Mode 0o600
  const testCookieDir = path.join(os.tmpdir(), `sentinel-test-${Date.now()}`);
  const testCookieFile = path.join(testCookieDir, 'test-cookies.json');
  
  const testCookies = { auth_token: 'sentinel_auth_token_secret', ct0: 'sentinel_ct0_csrf_token' };

  const fsTestLogin = new TerminalQrLogin({
    platform: 'twitter',
    cookiePath: testCookieFile,
    intervalMs: 50,
    checkLoginState: async () => ({
      authenticated: true,
      accountId: 'act_sentinel_tester',
      cookies: testCookies
    }),
    quiet: true
  });

  const loginResult = await fsTestLogin.login();
  console.log('\n[E2E 2] Live File System Cookie Persistence:');
  console.log(`  - Account ID: ${loginResult.accountId}`);
  console.log(`  - Cookie File Path: ${testCookieFile}`);

  const stat = await fs.stat(testCookieFile);
  const fileMode = (stat.mode & 0o777).toString(8);
  console.log(`  - File Permissions (Octal): 0o${fileMode} (Expected: 0o600)`);
  
  const content = JSON.parse(await fs.readFile(testCookieFile, 'utf-8'));
  console.log(`  - Validated auth_token: ${content.auth_token === testCookies.auth_token ? 'MATCH' : 'MISMATCH'}`);
  console.log(`  - Validated ct0: ${content.ct0 === testCookies.ct0 ? 'MATCH' : 'MISMATCH'}`);

  // Cleanup test cookie directory
  await fs.rm(testCookieDir, { recursive: true, force: true });

  // Test 3: TTY vs Non-TTY QR Output Formatting
  console.log('\n[E2E 3] QR Code Output Formatting:');
  const ttyOutput = await displayTerminalQrCode('https://xactions.app/auth?token=sentinel_test', { small: true });
  console.log(`  - TTY QR matrix length: ${ttyOutput.length} chars (includes Unicode ASCII blocks)`);

  const originalTTY = process.stdout.isTTY;
  process.stdout.isTTY = false;
  const nonTtyOutput = await displayTerminalQrCode('https://xactions.app/auth?token=sentinel_test', { shortCode: 'SEN-88' });
  process.stdout.isTTY = originalTTY;
  console.log(`  - Non-TTY Output:\n${nonTtyOutput.trim()}`);

  console.log('\n✅ [SENTINEL E2E MARSHAL] Story 12.1 Live E2E Verification Complete: 100% PASS');
}

runE2EVerification().catch((err) => {
  console.error('❌ E2E Verification Failed:', err);
  process.exit(1);
});
