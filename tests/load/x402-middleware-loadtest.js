/**
 * Load test for x402 payment middleware.
 *
 * Tests:
 * 1. Free endpoint (/api/ai/health) — baseline throughput
 * 2. Paid endpoint (/api/ai/scrape/profile) — 402 response under load
 * 3. Path filtering — non-AI path pass-through under load
 *
 * Usage:
 *   node tests/load/x402-middleware-loadtest.js
 *
 * Requirements:
 *   npx autocannon (auto-installed if missing)
 *
 * @author nichxbt
 */

import express from 'express';
import { x402Middleware, x402HealthCheck, x402Pricing } from '../../api/middleware/x402.js';

const PORT = 3999;
const DURATION = 10; // seconds per test
const CONNECTIONS = 50;
const WORKERS = 4;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(x402Middleware);

  // Free AI endpoints
  app.get('/api/ai/health', x402HealthCheck);
  app.get('/api/ai/pricing', x402Pricing);
  app.post('/api/ai/action/validate-session', (req, res) => {
    res.json({ success: true, valid: true });
  });

  // Paid AI endpoints (will return 402 without payment)
  app.post('/api/ai/scrape/profile', (req, res) => {
    res.json({ success: true, data: { username: req.body.username } });
  });
  app.post('/api/ai/scrape/followers', (req, res) => {
    res.json({ success: true, data: { followers: [] } });
  });

  // Free scripts endpoints
  app.get('/api/scripts', (req, res) => {
    res.json({ scripts: [] });
  });

  // Non-AI path (pass-through)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

async function runAutocannon(opts) {
  const { default: autocannon } = await import('autocannon');
  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
    // Optional: progress tracking
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

function formatResults(label, results) {
  const r = results;
  return {
    label,
    duration_sec: r.duration,
    connections: r.connections,
    workers: r.workers,
    total_requests: r.requests.total,
    completed_requests: r.requests.completed,
    errors: r.errors,
    timeouts: r.timeouts,
    req_sec: r.requests.average,
    req_sec_max: r.requests.max,
    latency_avg_ms: r.latency.average,
    latency_p50_ms: r.latency.p50,
    latency_p90_ms: r.latency.p90,
    latency_p99_ms: r.latency.p99,
    latency_max_ms: r.latency.max,
    throughput_avg_mb: r.throughput.average,
    status_codes: r.statusCodeStats,
    non2xx: r['2xx'] === undefined ? 0 : r.requests.total - r['2xx'],
  };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT, async () => {
    console.log(`\n🚀 x402 load test server started on port ${PORT}`);
    console.log(`   Duration: ${DURATION}s per test | Connections: ${CONNECTIONS} | Workers: ${WORKERS}\n`);

    const results = [];

    try {
      // Test 1: Free endpoint — health check
      console.log('━━━ Test 1: Free endpoint (/api/ai/health) ━━━');
      const r1 = await runAutocannon({
        url: `http://localhost:${PORT}/api/ai/health`,
        method: 'GET',
        duration: DURATION,
        connections: CONNECTIONS,
        workers: WORKERS,
      });
      const s1 = formatResults('Free endpoint (health)', r1);
      results.push(s1);
      console.log(`   ${s1.req_sec.toFixed(0)} req/s | latency p50=${s1.latency_p50_ms}ms p99=${s1.latency_p99_ms}ms | errors=${s1.errors}\n`);

      // Test 2: Paid endpoint — 402 response
      console.log('━━━ Test 2: Paid endpoint (/api/ai/scrape/profile → 402) ━━━');
      const r2 = await runAutocannon({
        url: `http://localhost:${PORT}/api/ai/scrape/profile`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser' }),
        duration: DURATION,
        connections: CONNECTIONS,
        workers: WORKERS,
      });
      const s2 = formatResults('Paid endpoint (402)', r2);
      results.push(s2);
      console.log(`   ${s2.req_sec.toFixed(0)} req/s | latency p50=${s2.latency_p50_ms}ms p99=${s2.latency_p99_ms}ms | errors=${s2.errors}\n`);

      // Test 3: Non-AI path — pass-through
      console.log('━━━ Test 3: Non-AI path (/health → pass-through) ━━━');
      const r3 = await runAutocannon({
        url: `http://localhost:${PORT}/health`,
        method: 'GET',
        duration: DURATION,
        connections: CONNECTIONS,
        workers: WORKERS,
      });
      const s3 = formatResults('Non-AI pass-through', r3);
      results.push(s3);
      console.log(`   ${s3.req_sec.toFixed(0)} req/s | latency p50=${s3.latency_p50_ms}ms p99=${s3.latency_p99_ms}ms | errors=${s3.errors}\n`);

      // Test 4: High concurrency — 200 connections on free endpoint
      console.log('━━━ Test 4: High concurrency (200 connections, /api/ai/health) ━━━');
      const r4 = await runAutocannon({
        url: `http://localhost:${PORT}/api/ai/health`,
        method: 'GET',
        duration: DURATION,
        connections: 200,
        workers: WORKERS,
      });
      const s4 = formatResults('High concurrency (200 conn)', r4);
      results.push(s4);
      console.log(`   ${s4.req_sec.toFixed(0)} req/s | latency p50=${s4.latency_p50_ms}ms p99=${s4.latency_p99_ms}ms | errors=${s4.errors}\n`);

      // Summary
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('                   LOAD TEST SUMMARY');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Label                          | req/s  | p50ms | p99ms | errors');
      console.log('───────────────────────────────|────────|───────|───────|───────');
      for (const r of results) {
        const label = r.label.padEnd(31);
        const reqSec = String(r.req_sec.toFixed(0)).padStart(7);
        const p50 = String(r.latency_p50_ms).padStart(6);
        const p99 = String(r.latency_p99_ms).padStart(6);
        const errs = String(r.errors).padStart(6);
        console.log(`${label} | ${reqSec} | ${p50} | ${p99} | ${errs}`);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Write JSON results
      const fs = await import('fs');
      const outputPath = '_bmad-output/test-artifacts/load-test-x402-middleware.json';
      fs.writeFileSync(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        config: { duration_sec: DURATION, connections: CONNECTIONS, workers: WORKERS },
        results,
      }, null, 2));
      console.log(`📊 Results saved to ${outputPath}\n`);

      // Verdict — error rate < 1% is acceptable for load testing
      const allPass = results.every(r => {
        const errorRate = r.total_requests > 0 ? r.errors / r.total_requests : 0;
        return errorRate < 0.01; // < 1% error rate
      });
      const minReqSec = Math.min(...results.map(r => r.req_sec));
      const maxP99 = Math.max(...results.map(r => r.latency_p99_ms));
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      const totalRequests = results.reduce((sum, r) => sum + r.total_requests, 0);
      const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : 0;

      console.log(`Verdict: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
      console.log(`  Min throughput: ${minReqSec.toFixed(0)} req/s`);
      console.log(`  Max p99 latency: ${maxP99}ms`);
      console.log(`  Total errors: ${totalErrors}/${totalRequests} (${overallErrorRate}%)`);

    } catch (err) {
      console.error('❌ Load test failed:', err);
      process.exitCode = 1;
    } finally {
      server.close();
      process.exit(0);
    }
  });
}

main();
