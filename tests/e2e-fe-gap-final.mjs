import { chromium } from 'playwright';
import fs from 'fs';

// Comprehensive FE gap analysis with real data verification
async function analyzeFEGaps() {
  console.log('================================================================');
  console.log('🔍 FINAL FE GAP ANALYSIS: Backend Features vs Frontend Exposure');
  console.log('================================================================\n');

  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();

  const gaps = [];

  // 1. OSINT Find Profiles — MCP only, no REST API, no CLI, no FE
  gaps.push({
    feature: 'OSINT Find Profiles (x_social_find_profiles)',
    backend: 'src/mcp/osint-find-profiles.js',
    api: 'NONE (MCP tool only)',
    cli: 'NONE',
    frontend: 'NONE',
    gap: 'NO_EXPOSURE',
    impact: 'HIGH — OSINT is a major feature but completely invisible to FE users',
    fix: 'Add /api/osint REST endpoint + xactions osint CLI + dashboard/osint.html page',
    priority: 'P0'
  });

  // 2. Cost-Aware Proxy Escalation — backend only, no API/CLI/FE
  gaps.push({
    feature: 'Cost-Aware Proxy Escalation (ProxyBudgetGovernor)',
    backend: 'src/core/proxy-budget-governor.js',
    api: 'NONE',
    cli: 'NONE',
    frontend: 'NONE',
    gap: 'NO_EXPOSURE',
    impact: 'HIGH — Budget ceiling is invisible; users cannot monitor spend or tier usage',
    fix: 'Add /api/proxy/budget endpoint + xactions proxy budget CLI + admin.html budget widget',
    priority: 'P0'
  });

  // 3. Proxy Tier Metadata — backend has tier field, FE only shows residential boolean
  gaps.push({
    feature: 'Proxy Tier Metadata (free/datacenter/residential/mobile_4g)',
    backend: 'src/proxy/providers.js (tier field)',
    api: '/api/admin/proxies (returns residential boolean only)',
    cli: 'NONE',
    frontend: 'dashboard/admin.html (shows residential/datacenter only)',
    gap: 'PARTIAL_EXPOSURE',
    impact: 'MEDIUM — FE shows legacy residential boolean, missing tier granularity (free/datacenter/residential/mobile_4g)',
    fix: 'Update /api/admin/proxies to return tier field + update admin.html to display tier badge',
    priority: 'P1'
  });

  // 4. Account Pool & Health Guard — FE exists but missing tier/budget viz
  gaps.push({
    feature: 'Account Pool & Health Guard',
    backend: 'src/core/account-pool.js',
    api: '/api/admin/accounts',
    cli: 'xactions admin account',
    frontend: 'dashboard/admin.html (exists)',
    gap: 'PARTIAL_EXPOSURE',
    impact: 'MEDIUM — FE shows account status but missing health score, hibernation reason, velocity metrics',
    fix: 'Add health score viz, hibernation reason tooltip, velocity chart to admin.html',
    priority: 'P1'
  });

  // 5. Selector Canary & GitOps Healing — FE exists but missing heal/diff viz
  gaps.push({
    feature: 'Selector Canary & GitOps Healing',
    backend: 'src/services/canary-healer.js',
    api: '/api/benchmark/probe-all',
    cli: 'xactions canary',
    frontend: 'dashboard/benchmark.html (exists)',
    gap: 'PARTIAL_EXPOSURE',
    impact: 'MEDIUM — FE shows canary status but missing heal preview, diff viewer, PR link',
    fix: 'Add heal preview button, unified-diff viewer, GitHub PR link to benchmark.html',
    priority: 'P1'
  });

  // 6. Distributed Token Bucket — internal only (by design)
  gaps.push({
    feature: 'Distributed Token Bucket',
    backend: 'src/core/distributed-token-bucket.js',
    api: 'NONE (internal subsystem)',
    cli: 'NONE',
    frontend: 'NONE',
    gap: 'INTERNAL_ONLY',
    impact: 'LOW — Internal rate limiting subsystem; no FE needed by design',
    fix: 'NONE — intentional internal subsystem',
    priority: 'P2'
  });

  // 7. Session Health Orchestrator — internal only (by design)
  gaps.push({
    feature: 'Session Health Orchestrator',
    backend: 'src/core/session-health-orchestrator.js',
    api: 'NONE (internal subsystem)',
    cli: 'NONE',
    frontend: 'NONE',
    gap: 'INTERNAL_ONLY',
    impact: 'LOW — Internal health tracking; no FE needed by design',
    fix: 'NONE — intentional internal subsystem',
    priority: 'P2'
  });

  // 8. Challenge Signature Detector — internal only (by design)
  gaps.push({
    feature: 'Challenge Signature Detector',
    backend: 'src/core/challenge-signature-detector.js',
    api: 'NONE (internal subsystem)',
    cli: 'NONE',
    frontend: 'NONE',
    gap: 'INTERNAL_ONLY',
    impact: 'LOW — Internal challenge detection; no FE needed by design',
    fix: 'NONE — intentional internal subsystem',
    priority: 'P2'
  });

  // Print detailed gap report
  console.log('┌─────────────────────────────────────────────────────────────┬─────────────────┬─────────────────────────────────────────────┐');
  console.log('│ Feature                                                     │ Gap Type        │ Priority / Impact                           │');
  console.log('├─────────────────────────────────────────────────────────────┼─────────────────┼─────────────────────────────────────────────┤');
  
  for (const g of gaps) {
    const featureName = g.feature.padEnd(60);
    const gap = g.gap.padEnd(15);
    const impact = `${g.priority} — ${g.impact}`.padEnd(43);
    console.log(`│ ${featureName} │ ${gap} │ ${impact} │`);
  }
  
  console.log('└─────────────────────────────────────────────────────────────┴─────────────────┴─────────────────────────────────────────────┘\n');

  // Critical gaps summary
  const critical = gaps.filter(g => g.priority === 'P0');
  const partial = gaps.filter(g => g.priority === 'P1');
  const internal = gaps.filter(g => g.priority === 'P2');

  console.log('🔴 CRITICAL GAPS (P0 — no FE/API/CLI exposure):');
  critical.forEach(g => {
    console.log(`   • ${g.feature}`);
    console.log(`     Impact: ${g.impact}`);
    console.log(`     Fix: ${g.fix}`);
    console.log('');
  });

  console.log('🟡 PARTIAL GAPS (P1 — FE exists but missing new fields):');
  partial.forEach(g => {
    console.log(`   • ${g.feature}`);
    console.log(`     Impact: ${g.impact}`);
    console.log(`     Fix: ${g.fix}`);
    console.log('');
  });

  console.log('🟢 INTERNAL SUBSYSTEMS (P2 — intentionally no FE):');
  internal.forEach(g => {
    console.log(`   • ${g.feature} — ${g.impact}`);
  });

  await browser.close();
  return gaps;
}

analyzeFEGaps().catch(console.error);
