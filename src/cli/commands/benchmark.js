// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions benchmark` CLI command group.
 * Story 34.5: Operator Scorecard CLI & Health Matrix.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import chalk from 'chalk';
import { defaultHealthTierCache } from '../../benchmark/health-tier-cache.js';

/**
 * Format a Tier letter with appropriate terminal colors.
 * @param {string} tier
 * @returns {string}
 */
export function formatTierBadge(tier) {
  switch (tier) {
    case 'A':
      return chalk.green.bold('A');
    case 'B':
      return chalk.yellow.bold('B');
    case 'C':
      return chalk.red.bold('C');
    default:
      return chalk.gray(tier || 'UNKNOWN');
  }
}

/**
 * Draw a mini ASCII progress bar.
 * @param {number} score 0 - 100
 * @param {number} [width=10]
 * @returns {string}
 */
export function drawProgressBar(score, width = 10) {
  const clamped = Math.min(Math.max(Number(score) || 0, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  if (clamped >= 90) return chalk.green(bar);
  if (clamped >= 70) return chalk.yellow(bar);
  return chalk.red(bar);
}

/**
 * Format a list of scraper health records into an ASCII table.
 * @param {Array<Record<string, any>>} records
 * @returns {string}
 */
export function formatBenchmarkTable(records = []) {
  if (!records || records.length === 0) {
    return chalk.yellow('ℹ️ No benchmark scores available yet.');
  }

  const headers = [
    'Scraper ID'.padEnd(24),
    'Platform'.padEnd(12),
    'Health'.padEnd(8),
    'Tier'.padEnd(6),
    'Stab'.padEnd(7),
    'Qual'.padEnd(7),
    'Noise'.padEnd(7),
    'Cost'.padEnd(7),
    'Samples'.padEnd(9),
    'Status'.padEnd(12),
    'Last Evaluated',
  ];

  const separator = '-'.repeat(110);
  const headerLine = chalk.bold(headers.join(' '));

  const rows = records.map((r) => {
    const id = String(r.scraperId || 'unknown').padEnd(24);
    const plat = String(r.platform || 'unknown').padEnd(12);
    const scoreVal = typeof r.healthScore === 'number' ? r.healthScore.toFixed(1) : 'N/A';
    const score = (r.healthScore >= 90 ? chalk.green.bold(scoreVal) : (r.healthScore >= 70 ? chalk.yellow.bold(scoreVal) : chalk.red.bold(scoreVal))).padEnd(17);
    const tier = formatTierBadge(r.tier).padEnd(15);
    const stab = (typeof r.stabilityScore === 'number' ? r.stabilityScore.toFixed(0) : '-').padEnd(7);
    const qual = (typeof r.qualityScore === 'number' ? r.qualityScore.toFixed(0) : '-').padEnd(7);
    const noise = (typeof r.noiseScore === 'number' ? r.noiseScore.toFixed(0) : '-').padEnd(7);
    const cost = (typeof r.costScore === 'number' ? r.costScore.toFixed(0) : '-').padEnd(7);
    const samples = String(r.sampleCount ?? '-').padEnd(9);

    const isAlert = r.tier === 'C';
    const status = (isAlert ? chalk.bgRed.white.bold(' ⚠️ ALERT ') : chalk.green('NORMAL')).padEnd(isAlert ? 21 : 12);
    const evaluated = r.evaluatedAt ? new Date(r.evaluatedAt).toISOString().replace('T', ' ').substring(0, 19) : '-';

    return `${id} ${plat} ${score} ${tier} ${stab} ${qual} ${noise} ${cost} ${samples} ${status} ${evaluated}`;
  });

  return [headerLine, separator, ...rows].join('\n');
}

/**
 * Format in-depth scorecard detail for a single scraper.
 * @param {Record<string, any>} detail
 * @param {Array<Record<string, any>>} [history=[]]
 * @returns {string}
 */
export function formatScraperDetail(detail, history = []) {
  if (!detail) {
    return chalk.red('❌ Scraper details unavailable.');
  }

  const raw = detail.metricsSnapshot?.raw || {};
  const knockoutTriggered = Boolean(detail.metricsSnapshot?.knockoutTriggered);
  const knockoutReasons = detail.metricsSnapshot?.knockoutReasons || [];

  const lines = [
    chalk.bold.cyan(`\n═══════════════════ Scorecard: ${detail.scraperId} ═══════════════════`),
    `${chalk.bold('Platform:')} ${detail.platform}    ${chalk.bold('Tier:')} ${formatTierBadge(detail.tier)}    ${chalk.bold('Health Score:')} ${detail.healthScore?.toFixed(1) ?? 'N/A'}/100`,
    `${chalk.bold('Evaluated:')} ${detail.evaluatedAt ? new Date(detail.evaluatedAt).toISOString() : '-'}    ${chalk.bold('Samples:')} ${detail.sampleCount ?? 0} runs`,
    `${chalk.bold('Consecutive Clean Runs:')} ${detail.consecutiveCleanRuns ?? 0}`,
    '',
    chalk.bold('── 4-Pillar Breakdown ──────────────────────────────────────────'),
    `Stability : ${drawProgressBar(detail.stabilityScore)} ${detail.stabilityScore?.toFixed(1) ?? 0}%`,
    `Quality   : ${drawProgressBar(detail.qualityScore)} ${detail.qualityScore?.toFixed(1) ?? 0}%`,
    `Noise     : ${drawProgressBar(detail.noiseScore)} ${detail.noiseScore?.toFixed(1) ?? 0}%`,
    `Cost      : ${drawProgressBar(detail.costScore)} ${detail.costScore?.toFixed(1) ?? 0}%`,
    '',
    chalk.bold('── Hard Knock-Out Gates ────────────────────────────────────────'),
    knockoutTriggered
      ? chalk.red.bold(`Knock-Out Gates: TRIGGERED\n  ${knockoutReasons.map((r) => `❌ ${r}`).join('\n  ')}`)
      : chalk.green.bold('Knock-Out Gates: PASSED (All reliability thresholds satisfied)'),
    '',
    chalk.bold('── Key Metrics Snapshot ────────────────────────────────────────'),
    `True Success Rate    : ${raw.true_success_rate !== undefined ? (raw.true_success_rate * 100).toFixed(1) + '%' : '-'}`,
    `P95 Latency          : ${raw.latency_p95 !== undefined ? raw.latency_p95 + ' ms' : '-'}`,
    `False 200 Rate       : ${raw.false_200_rate !== undefined ? (raw.false_200_rate * 100).toFixed(2) + '%' : '-'}`,
    `Field Fill Rate      : ${raw.field_fill_rate !== undefined ? (raw.field_fill_rate * 100).toFixed(1) + '%' : '-'}`,
    `Schema Integrity     : ${raw.schema_integrity_rate !== undefined ? (raw.schema_integrity_rate * 100).toFixed(1) + '%' : '-'}`,
    `Duplicate Ratio      : ${raw.duplicate_ratio !== undefined ? (raw.duplicate_ratio * 100).toFixed(2) + '%' : '-'}`,
    `Proxy Bytes per 1k   : ${raw.proxy_bytes_per_1k !== undefined ? (raw.proxy_bytes_per_1k / (1024 * 1024)).toFixed(2) + ' MB' : '-'}`,
    `Checkpoint Rate      : ${raw.checkpoint_rate !== undefined ? (raw.checkpoint_rate * 100).toFixed(2) + '%' : '-'}`,
  ];

  if (history && history.length > 0) {
    lines.push('');
    lines.push(chalk.bold('── Evaluation History (Recent) ─────────────────────────────────'));
    for (const h of history.slice(0, 5)) {
      const dateStr = h.evaluatedAt ? new Date(h.evaluatedAt).toISOString().substring(0, 19).replace('T', ' ') : '-';
      lines.push(`• [${dateStr}] Score: ${h.healthScore?.toFixed(1)}  Tier: ${formatTierBadge(h.tier)}`);
    }
  }

  lines.push(chalk.cyan('════════════════════════════════════════════════════════════════\n'));
  return lines.join('\n');
}

/**
 * Format a list of benchmark alerts into an ASCII table.
 * @param {Array<Record<string, any>>} alerts
 * @returns {string}
 */
export function formatAlertsTable(alerts = []) {
  if (!alerts || alerts.length === 0) {
    return chalk.green('✅ No active or recent benchmark alerts. All scrapers operating within normal parameters.');
  }

  const headers = [
    'Scraper ID'.padEnd(20),
    'Platform'.padEnd(12),
    'Transition'.padEnd(14),
    'Score'.padEnd(8),
    'Reason'.padEnd(35),
    'Timestamp',
  ];

  const separator = '-'.repeat(105);
  const headerLine = chalk.bold(headers.join(' '));

  const rows = alerts.map((a) => {
    const id = String(a.scraper_id || a.scraperId || 'unknown').padEnd(20);
    const plat = String(a.platform || 'unknown').padEnd(12);
    const transition = `${a.previous_tier || '?' } -> ${chalk.red.bold(a.current_tier || 'C')}`.padEnd(23);
    const scoreVal = typeof a.health_score === 'number' ? a.health_score.toFixed(1) : (typeof a.healthScore === 'number' ? a.healthScore.toFixed(1) : '-');
    const score = chalk.red.bold(scoreVal).padEnd(17);
    const reason = String(a.reason || 'Tier C degradation').substring(0, 33).padEnd(35);
    const ts = a.evaluated_at ? new Date(a.evaluated_at).toISOString().replace('T', ' ').substring(0, 19) : '-';

    return `${id} ${plat} ${transition} ${score} ${reason} ${ts}`;
  });

  return [headerLine, separator, ...rows].join('\n');
}

/**
 * Register `xactions benchmark` CLI command.
 * @param {import('commander').Command} program
 * @param {Object} [deps]
 * @param {import('@prisma/client').PrismaClient} [deps.prisma]
 */
export function registerBenchmarkCommand(program, deps = {}) {
  const handleList = async (options = {}) => {
    let prisma = deps.prisma;
    if (!prisma) {
      try {
        const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
        prisma = sharedPrisma;
      } catch {
        // Prisma might be optional or offline
      }
    }

    if (!prisma) {
      console.error(chalk.red('❌ Database connection unavailable for benchmark inspection.'));
      return;
    }

    try {
      const parsedLimit = parseInt(options.limit, 10);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
      const rawRecords = await prisma.scraperHealthScore.findMany({
        distinct: ['scraperId'],
        orderBy: { evaluatedAt: 'desc' },
        take: limit,
      });

      let records = rawRecords;

      // Apply filters
      if (options.tier) {
        const targetTier = String(options.tier).toUpperCase();
        records = records.filter((r) => r.tier === targetTier);
      }

      if (options.platform) {
        const targetPlatform = String(options.platform).toLowerCase();
        records = records.filter((r) => String(r.platform).toLowerCase().includes(targetPlatform));
      }

      // Sync with live tier cache if available
      records = records.map((r) => {
        const liveTier = defaultHealthTierCache.get(r.scraperId);
        return {
          ...r,
          tier: liveTier !== 'UNKNOWN' ? liveTier : r.tier,
        };
      });

      const isJson = options.format === 'json' || Boolean(options.json);
      if (isJson) {
        console.log(JSON.stringify(records, null, 2));
      } else {
        console.log(formatBenchmarkTable(records));
      }
    } catch (err) {
      console.error(chalk.red(`❌ Failed to retrieve benchmark scores: ${err.message}`));
    }
  };

  const benchmarkCmd = program
    .command('benchmark')
    .description('Inspect scraper benchmark reliability, health scores, and tier status');

  // Subcommand: list (default)
  benchmarkCmd
    .command('list', { isDefault: true })
    .description('List latest health scorecard for all monitored scrapers')
    .option('-t, --tier <tier>', 'Filter by health tier (A, B, C)')
    .option('-p, --platform <platform>', 'Filter by platform name')
    .option('--limit <n>', 'Limit number of results', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--json', 'Alias for --format json', false)
    .action(async (options) => {
      await handleList(options);
    });

  // Subcommand: detail <scraperId>
  benchmarkCmd
    .command('detail <scraperId>')
    .description('Display detailed scorecard, 4-pillar breakdown, and knock-out diagnostics for a scraper')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--json', 'Alias for --format json', false)
    .action(async (scraperId, options) => {
      let prisma = deps.prisma;
      if (!prisma) {
        try {
          const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
          prisma = sharedPrisma;
        } catch {}
      }

      if (!prisma) {
        console.error(chalk.red('❌ Database connection unavailable for benchmark inspection.'));
        return;
      }

      try {
        const detail = await prisma.scraperHealthScore.findFirst({
          where: { scraperId },
          orderBy: { evaluatedAt: 'desc' },
        });

        if (!detail) {
          console.error(chalk.red(`❌ Scraper "${scraperId}" not found in benchmark registry.`));
          return;
        }

        const history = await prisma.scraperHealthScore.findMany({
          where: { scraperId },
          orderBy: { evaluatedAt: 'desc' },
          take: 10,
          select: { healthScore: true, tier: true, evaluatedAt: true },
        });

        if (options.format === 'json' || options.json) {
          console.log(JSON.stringify({ detail, history }, null, 2));
        } else {
          console.log(formatScraperDetail(detail, history));
        }
      } catch (err) {
        console.error(chalk.red(`❌ Failed to fetch scraper scorecard: ${err.message}`));
      }
    });

  // Subcommand: alerts
  benchmarkCmd
    .command('alerts')
    .description('Display recent scraper health alerts and Tier C operator incident history')
    .option('--limit <n>', 'Limit number of alerts', '20')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--json', 'Alias for --format json', false)
    .action(async (options) => {
      let dispatcher = deps.alertDispatcher;
      if (!dispatcher) {
        try {
          const { defaultAlertDispatcher } = await import('../../../api/services/benchmark/alerting.js');
          dispatcher = defaultAlertDispatcher;
        } catch {}
      }

      const limit = parseInt(options.limit, 10) || 20;
      const alerts = dispatcher ? dispatcher.getAlerts({ limit }) : [];

      if (options.format === 'json' || options.json) {
        console.log(JSON.stringify(alerts, null, 2));
      } else {
        console.log(formatAlertsTable(alerts));
      }
    });
}
