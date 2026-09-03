// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions admin` command group — stream metrics, alerts & operational management.
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import { printCliError, printGovernorStatus } from '../shared.js';

/**
 * @param {import('commander').Command} program
 */
export function registerAdminCommand(program) {
  const adminCmd = program
    .command('admin')
    .description('Operator administration, observability, and stream metrics (Epic 19 / Story 14.3)');

  const streamCmd = adminCmd
    .command('stream')
    .description('Manage and inspect Nowing Redis Stream and NLP workers');

  // xactions admin status
  adminCmd
    .command('status')
    .description('Show system and rate governor status (proxies, throttling, hibernation)')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const baseUrl = options.url || process.env.API_URL || process.env.MCP_SERVER_URL || 'http://localhost:3001';
        let status;

        try {
          const headers = /** @type {Record<string, string>} */ ({});
          if (options.token) headers.Authorization = `Bearer ${options.token}`;
          const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/admin/governor/status`, { headers });
          if (resp.ok) {
            const data = await resp.json();
            status = data.status;
          }
        } catch {
          // Network error or endpoint down; proceed to in-process fallback below
        }

        if (!status) {
          const { globalStatusApi, globalAdaptiveRateGovernor } = await import('../../core/index.js');
          const { refreshGovernorConsumerLag, globalStreamMetricsReader } = await import('../../utils/stream-metrics.js');
          await refreshGovernorConsumerLag(globalAdaptiveRateGovernor, globalStreamMetricsReader);
          status = globalStatusApi.getGovernorStatus();
        }

        printGovernorStatus(status, { json: options.json });
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // xactions admin stream metrics
  streamCmd
    .command('metrics')
    .description('Display real-time stream metrics (events/sec, consumer lag, pending messages)')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Optional Bearer token if the endpoint requires auth')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const baseUrl = options.url || process.env.MCP_SERVER_URL || process.env.API_URL || 'http://localhost:3001';
        let metrics;

        try {
          const headers = /** @type {Record<string, string>} */ ({ });
          if (options.token) headers.Authorization = `Bearer ${options.token}`;
          const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/metrics/stream`, { headers });
          if (resp.ok) {
            metrics = await resp.json();
          }
        } catch {
          // Direct in-process fallback
          const { defaultStreamMetricsCollector } = await import('../../utils/stream-metrics-collector.js');
          metrics = await defaultStreamMetricsCollector.getMetrics();
        }

        if (!metrics) {
          const { defaultStreamMetricsCollector } = await import('../../utils/stream-metrics-collector.js');
          metrics = await defaultStreamMetricsCollector.getMetrics();
        }

        if (options.json) {
          console.log(JSON.stringify(metrics, null, 2));
          return;
        }

        console.log(chalk.bold('\n📊 Nowing Social Redis Stream Metrics (stream:social:raw_posts)\n'));
        console.log(`  • ${chalk.cyan('Events / Sec')}:      ${chalk.green(metrics.eventsPerSecond ?? 0)}`);
        console.log(`  • ${chalk.cyan('Pending Messages')}:  ${chalk.yellow((metrics.pendingMessages ?? 0).toLocaleString())}`);
        console.log(`  • ${chalk.cyan('Consumer Lag')}:      ${metrics.consumerLag > 10000 ? chalk.red((metrics.consumerLag ?? 0).toLocaleString()) : chalk.green((metrics.consumerLag ?? 0).toLocaleString())}`);
        console.log(`  • ${chalk.cyan('Dropped Events')}:    ${chalk.dim(metrics.droppedEvents ?? 0)}`);
        console.log(`  • ${chalk.cyan('Last Ack Idle')}:     ${metrics.lastAckTime > 60 ? chalk.red(`${metrics.lastAckTime}s`) : chalk.green(`${metrics.lastAckTime}s`)}`);
        console.log(`  • ${chalk.cyan('Max Length')}:        ${chalk.dim((metrics.maxLen ?? 0).toLocaleString())}`);
        console.log(`  • ${chalk.cyan('Oldest Min ID')}:     ${chalk.dim(metrics.minId || 'none')}\n`);
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // xactions admin stream alerts
  streamCmd
    .command('alerts')
    .description('Display recent stream alerts and threshold status')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const baseUrl = options.url || process.env.API_URL || process.env.MCP_SERVER_URL || 'http://localhost:3001';
        let alertStatus;

        try {
          const headers = /** @type {Record<string, string>} */ ({});
          if (options.token) headers.Authorization = `Bearer ${options.token}`;
          const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/admin/stream/alerts`, { headers });
          if (resp.ok) {
            const data = await resp.json();
            alertStatus = data.alerts || data;
          }
        } catch {
          // Direct fallback
          const { defaultStreamAlertEngine } = await import('../../utils/stream-alerts.js');
          alertStatus = defaultStreamAlertEngine.getAlertStatus();
        }

        if (!alertStatus) {
          const { defaultStreamAlertEngine } = await import('../../utils/stream-alerts.js');
          alertStatus = defaultStreamAlertEngine.getAlertStatus();
        }

        if (options.json) {
          console.log(JSON.stringify(alertStatus, null, 2));
          return;
        }

        console.log(chalk.bold('\n🚨 Nowing Stream Alerts & Threshold Status\n'));
        console.log(`  • ${chalk.cyan('Total Alerts Triggered')}: ${alertStatus.totalAlertsTriggered ?? 0}`);
        console.log(`  • ${chalk.cyan('Last Alert Timestamp')}:   ${chalk.dim(alertStatus.lastAlertTimestamp || 'Never')}\n`);

        const active = /** @type {Array<{ alert: string, value: number, threshold: number, timestamp: string }>} */ (alertStatus.activeAlerts || []);
        if (active.length === 0) {
          console.log(`  ${chalk.green('✔ No recent threshold breaches detected.')}\n`);
        } else {
          console.log(chalk.bold('Recent Alerts:'));
          active.forEach((a, idx) => {
            console.log(`  ${idx + 1}. [${chalk.red(a.alert)}] Value: ${chalk.yellow(a.value)} (Threshold: ${a.threshold}) at ${chalk.dim(a.timestamp)}`);
          });
          console.log();
        }
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)));
      }
    });
}
