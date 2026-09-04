// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E smoke test for Epic 19 admin CLI commands with real data.
 * Runs the XActions Express API server in-process so singletons
 * (proxy pool, account pool, stream alerts) are shared with the REST layer.
 * Then executes the real `xactions` CLI against http://localhost:3001.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { spawn } from 'child_process';
import jwt from 'jsonwebtoken';
import prisma from '../api/lib/prisma.js';
import '../api/server.js';
import { globalProxyPool } from '../src/proxy/proxy-pool.js';
import { globalAccountPool } from '../src/core/account-pool.js';

const BASE_URL = 'http://localhost:3001';
const ADMIN_EMAIL = 'e2e_admin@xactions.test';
const ADMIN_USERNAME = 'e2e_admin';
const ADMIN_PASSWORD = 'e2e-password';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-local-development';

/**
 * Run the XActions CLI with a timeout. The CLI sometimes keeps the event loop
 * alive after printing output (e.g., loaded modules with background timers), so
 * we resolve as soon as stdout/stderr close or the timeout expires.
 *
 * @param {string} cmd
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
function runCli(cmd) {
  const args = ['src/cli/index.js', ...cmd.split(/\s+/).map((arg) => arg.replace(/^["']|["']$/g, ''))];
  return new Promise((resolve) => {
    const child = spawn('node', args, {
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, 10000);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ ok: !killed && code === 0, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, stdout, stderr: err.message });
    });
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start listening within timeout');
}

async function main() {
  console.log('🔧 E2E Admin CLI Test Setup\n');

  // Importing api/server.js starts the HTTP server in the same process.
  // Wait until the health endpoint is ready before seeding data.
  await waitForServer();
  console.log(`✅ In-process API server listening on ${BASE_URL}`);

  // 1. Upsert an admin user in Prisma
  let user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        isAdmin: true,
      },
    });
    console.log(`✅ Created admin user: ${user.id}`);
  } else {
    console.log(`✅ Using existing admin user: ${user.id}`);
  }

  // 2. Generate JWT token
  const token = jwt.sign({ userId: user.id, isAdmin: true }, JWT_SECRET, { expiresIn: '1h' });

  // 3. Seed real data into singletons shared with the in-process server
  const testProxy = 'http://1.2.3.4:8080';
  globalProxyPool.add(testProxy);
  console.log(`✅ Seeded proxy: ${testProxy}`);

  const accountId1 = 'e2e_acc_twitter_01';
  const accountId2 = 'e2e_acc_twitter_02';
  globalAccountPool.registerAccounts('twitter', [accountId1, accountId2]);
  globalAccountPool.markUnavailable(accountId1, 'rate_limit', 60 * 60 * 1000, 'twitter');
  globalAccountPool.markUnavailable(accountId2, 'rate_limit', 60 * 60 * 1000, 'twitter');
  console.log(`✅ Seeded hibernating accounts: ${accountId1}, ${accountId2}`);

  const checkpointId = 'cp_e2e_test_cli';
  await prisma.crawlCheckpoint.upsert({
    where: { id: checkpointId },
    create: {
      id: checkpointId,
      platform: 'twitter',
      targetType: 'profile',
      targetKey: 'e2e_test_user',
      status: 'failed',
    },
    update: { status: 'failed' },
  });
  console.log(`✅ Seeded failed checkpoint: ${checkpointId}`);

  // 4. Run CLI commands against REST API
  const commands = [
    `admin status --url ${BASE_URL} --token ${token} --json`,
    `admin proxies list --url ${BASE_URL} --token ${token} --json`,
    `admin proxies quarantine "${testProxy}" --url ${BASE_URL} --token ${token} --json`,
    `admin proxies release "${testProxy}" --url ${BASE_URL} --token ${token} --json`,
    `admin accounts list --url ${BASE_URL} --token ${token} --json`,
    `admin accounts wake ${accountId1} --platform twitter --url ${BASE_URL} --token ${token} --json`,
    `admin accounts rotate ${accountId1} twitter --url ${BASE_URL} --token ${token} --json`,
    `admin checkpoints list --url ${BASE_URL} --token ${token} --json`,
    `admin checkpoints resume ${checkpointId} --url ${BASE_URL} --token ${token} --json`,
    `admin checkpoints pause ${checkpointId} --url ${BASE_URL} --token ${token} --json`,
    `admin checkpoints retry ${checkpointId} --url ${BASE_URL} --token ${token} --json`,
    `admin stream metrics --url ${BASE_URL} --token ${token} --json`,
    `admin stream alerts --url ${BASE_URL} --token ${token} --json`,
    `admin stream test --url ${BASE_URL} --token ${token} --json`,
  ];

  let passCount = 0;
  let failCount = 0;

  for (const cmd of commands) {
    console.log(`\n▶️  xactions ${cmd}`);
    const result = await runCli(cmd);
    if (result.ok) {
      try {
        const json = JSON.parse(result.stdout);
        if (json.success === true || json.success === undefined) {
          console.log('✅ PASS');
          passCount++;
        } else {
          console.log('❌ FAIL (success=false)');
          console.log(result.stdout);
          failCount++;
        }
      } catch {
        console.log('✅ PASS (non-JSON human output)');
        passCount++;
      }
    } else {
      console.log('❌ FAIL');
      console.log('STDOUT:', result.stdout);
      console.log('STDERR:', result.stderr);
      failCount++;
    }
  }

  // 5. Cleanup
  try {
    await prisma.crawlCheckpoint.delete({ where: { id: checkpointId } });
    globalProxyPool.release(testProxy);
    await prisma.user.delete({ where: { id: user.id } });
    console.log('\n🧹 Cleanup complete');
  } catch (err) {
    console.warn('\n⚠️ Cleanup warning:', err instanceof Error ? err.message : String(err));
  }

  console.log(`\n🎯 E2E Results: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('❌ E2E script error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
