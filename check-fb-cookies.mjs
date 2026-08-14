#!/usr/bin/env node
/**
 * Check Facebook cookies from miniku.txt — find live (non-checkpointed) accounts.
 * Inserts live accounts into DB via API.
 *
 * Usage:
 *   node check-fb-cookies.mjs
 *
 * @author nichxbt
 */

import fs from 'fs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const API_BASE = 'http://localhost:3001/api/facebook/accounts';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-local-development';
const COOKIE_FILE = '/Users/luisphan/Downloads/miniku.txt';

const prisma = new PrismaClient();

// Parse cookie string → { c_user, xs, datr }
function parseCookie(cookieStr) {
  const cookies = cookieStr.split(';').filter(c => c.includes('=')).map(c => c.trim());
  const map = {};
  for (const c of cookies) {
    const eqIdx = c.indexOf('=');
    const name = c.slice(0, eqIdx).trim();
    const value = c.slice(eqIdx + 1).trim();
    map[name] = value;
  }
  return {
    c_user: map.c_user,
    xs: map.xs,
    datr: map.datr,
  };
}

// Parse miniku.txt line → { uid, password, cookie, proxy }
function parseLine(line) {
  const parts = line.split('|');
  if (parts.length < 3) return null;
  const uid = parts[0].trim();
  const password = parts[1].trim();
  const cookieStr = parts[2].trim();
  const proxy = parts[3]?.trim() || '';
  const cookie = parseCookie(cookieStr);
  return { uid, password, cookie, proxy };
}

// Check if a cookie is live by making an HTTP request to Facebook
async function checkCookieLive(cookie) {
  try {
    const cookieHeader = `c_user=${cookie.c_user}; xs=${cookie.xs}; datr=${cookie.datr}`;
    const resp = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
    });

    const status = resp.status;
    const location = resp.headers.get('location') || '';
    const text = await resp.text().catch(() => '');

    // Check for checkpoint indicators
    const isCheckpoint = /checkpoint|confirm.*identity|confirm.*account|locked.*account|video.*selfie/i.test(text + location);
    const isLoginWall = /login\.php|login_page|login_form/i.test(text + location) || status === 302 && /login/.test(location);

    if (isCheckpoint) return { live: false, reason: 'checkpoint', status };
    if (isLoginWall) return { live: false, reason: 'login_wall', status };
    if (status === 200) return { live: true, reason: 'ok', status };
    if (status === 302 && !/login|checkpoint/.test(location)) return { live: true, reason: 'redirect_ok', status, location };

    return { live: false, reason: `status_${status}`, status };
  } catch (err) {
    return { live: false, reason: `error: ${err.message}`, status: 0 };
  }
}

// Check cookie via Facebook mobile endpoint (more reliable)
async function checkCookieLiveMobile(cookie) {
  try {
    const cookieHeader = `c_user=${cookie.c_user}; xs=${cookie.xs}; datr=${cookie.datr}`;
    const resp = await fetch('https://m.facebook.com/home.php', {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      redirect: 'manual',
    });

    const status = resp.status;
    const location = resp.headers.get('location') || '';
    const text = await resp.text().catch(() => '').then(t => t.slice(0, 2000));

    const isCheckpoint = /checkpoint|confirm.*identity|confirm.*account|locked.*account|video.*selfie|confirm_this/i.test(text + location);
    const isLoginWall = /login\.php|login_page|login_form|login\.aspx/i.test(text + location) || (status === 302 && /login/i.test(location));

    if (isCheckpoint) return { live: false, reason: 'checkpoint', status };
    if (isLoginWall) return { live: false, reason: 'login_wall', status };
    if (status === 200) {
      // Additional check: look for "Log In" or "Sign Up" in the page
      if (/log in to facebook|sign up for facebook/i.test(text)) {
        return { live: false, reason: 'login_wall_in_page', status };
      }
      return { live: true, reason: 'ok', status };
    }
    if (status === 302 && !/login|checkpoint/i.test(location)) return { live: true, reason: 'redirect_ok', status, location };

    return { live: false, reason: `status_${status}`, status };
  } catch (err) {
    return { live: false, reason: `error: ${err.message}`, status: 0 };
  }
}

// Add account to DB via API
async function addAccountToDB(token, uid, cookie) {
  try {
    const resp = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        label: `fb-${uid}`,
        c_user: cookie.c_user,
        xs: cookie.xs,
      }),
    });
    const data = await resp.json();
    return { ok: data.ok, id: data.id, error: data.error, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== Facebook Cookie Checker ===\n');

  // Read and parse cookie file
  const content = fs.readFileSync(COOKIE_FILE, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const accounts = lines.map(parseLine).filter(Boolean);

  console.log(`Parsed ${accounts.length} accounts from ${COOKIE_FILE}\n`);

  // Get user ID for JWT
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.error('❌ No user found in DB');
    process.exit(1);
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
  console.log(`Using user: ${user.email} (${user.id})\n`);

  // Check each cookie
  const results = [];
  const liveAccounts = [];

  console.log('Checking cookies (mobile endpoint)...\n');
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (!acc.cookie.c_user || !acc.cookie.xs) {
      console.log(`[${i + 1}/${accounts.length}] ${acc.uid} — ❌ missing c_user or xs`);
      results.push({ ...acc, result: { live: false, reason: 'missing_fields' } });
      continue;
    }

    const result = await checkCookieLiveMobile(acc.cookie);
    const status = result.live ? '✅ LIVE' : `❌ ${result.reason}`;
    console.log(`[${i + 1}/${accounts.length}] ${acc.uid} — ${status} (HTTP ${result.status})`);

    results.push({ ...acc, result });
    if (result.live) {
      liveAccounts.push(acc);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Summary: ${liveAccounts.length}/${accounts.length} live ===\n`);

  if (liveAccounts.length === 0) {
    console.log('❌ No live accounts found.');
    console.log('\nAll results:');
    for (const r of results) {
      console.log(`  ${r.uid} — ${r.result.reason} (HTTP ${r.result.status})`);
    }
    await prisma.$disconnect();
    process.exit(0);
  }

  // Add live accounts to DB
  console.log(`Adding ${liveAccounts.length} live accounts to DB...\n`);
  let added = 0;
  let skipped = 0;
  for (const acc of liveAccounts) {
    const dbResult = await addAccountToDB(token, acc.uid, acc.cookie);
    if (dbResult.ok) {
      console.log(`✅ Added ${acc.uid} to DB (id: ${dbResult.id})`);
      added++;
    } else if (dbResult.status === 409) {
      console.log(`⚠️ ${acc.uid} already exists in DB — skipping`);
      skipped++;
    } else {
      console.log(`❌ Failed to add ${acc.uid}: ${dbResult.error}`);
    }
  }

  console.log(`\n=== DB Import: ${added} added, ${skipped} skipped ===`);

  // Output first live account for testing
  if (liveAccounts.length > 0) {
    const first = liveAccounts[0];
    console.log(`\n=== First live account for testing ===`);
    console.log(`UID: ${first.uid}`);
    console.log(`c_user: ${first.cookie.c_user}`);
    console.log(`xs: ${first.cookie.xs}`);
    console.log(`datr: ${first.cookie.datr}`);
    console.log(`Proxy: ${first.proxy || 'none'}`);
  }

  // List all live accounts
  console.log(`\n=== All live accounts ===`);
  for (const acc of liveAccounts) {
    console.log(`  ${acc.uid} | proxy: ${acc.proxy || 'none'}`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
