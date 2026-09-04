// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions admin` command group — status, proxies, accounts, checkpoints, and stream metrics.
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import { printCliError, printGovernorStatus, parseCliPositiveInt, parseCliNonNegativeInt, disconnectPrisma } from '../shared.js';

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

  // xactions admin proxies
  const proxiesCmd = adminCmd
    .command('proxies')
    .description('Manage proxy pool health, quarantine, and release');

  proxiesCmd
    .command('list')
    .description('List all registered proxies with status and partition')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const baseUrl = options.url || process.env.API_URL || process.env.MCP_SERVER_URL || 'http://localhost:3001';
        /** @type {any} */
        let data;

        try {
          const headers = /** @type {Record<string, string>} */ ({});
          if (options.token) headers.Authorization = `Bearer ${options.token}`;
          const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/admin/proxies`, { headers });
          if (resp.ok) {
            const body = await resp.json();
            data = body.proxies || body;
          }
        } catch {
          // Network error; fall through to in-process call
        }

        if (!data) {
          const { globalProxyPool } = await import('../../proxy/proxy-pool.js');
          data = globalProxyPool.listProxies();
        }

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const proxies = Array.isArray(data) ? data : [];
        console.log(chalk.bold(`\n🌐 Proxies (Total: ${proxies.length})\n`));
        if (proxies.length === 0) {
          console.log(chalk.dim('  No proxies registered.'));
        } else {
          const healthyCount = proxies.filter((p) => p.status === 'healthy').length;
          console.log(`  ${chalk.bold('Healthy:')} ${chalk.green(healthyCount)} / ${proxies.length}`);
          console.log();
          console.log(`  ${chalk.bold('Server'.padEnd(32))} ${chalk.bold('Status'.padEnd(12))} ${chalk.bold('Pool'.padEnd(10))}`);
          proxies.forEach((p) => {
            const statusColor = p.status === 'healthy' ? chalk.green : chalk.yellow;
            console.log(`  ${String(p.server || p.key || p.host).padEnd(32)} ${statusColor((p.status || 'unknown').padEnd(12))} ${chalk.cyan((p.pool || 'realtime').padEnd(10))}`);
          });
        }
        console.log();
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // xactions admin accounts
  const accountsCmd = adminCmd
    .command('accounts')
    .description('Manage account pool, hibernation, and rotation');

  accountsCmd
    .command('list')
    .description('List all accounts with hibernation status and velocity')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--platform <platform>', 'Filter by platform (twitter, facebook, etc.)')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const baseUrl = options.url || process.env.API_URL || process.env.MCP_SERVER_URL || 'http://localhost:3001';
        /** @type {any} */
        let data;

        try {
          const headers = /** @type {Record<string, string>} */ ({});
          if (options.token) headers.Authorization = `Bearer ${options.token}`;
          const query = options.platform ? `?platform=${encodeURIComponent(options.platform)}` : '';
          const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/admin/accounts${query}`, { headers });
          if (resp.ok) {
            const body = await resp.json();
            data = body.accounts || body;
          }
        } catch {
          // Network error; fall through to in-process call
        }

        if (!data) {
          const { globalAccountPool } = await import('../../core/index.js');
          data = globalAccountPool.listAccountDetails(options.platform);
        }

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const accounts = Array.isArray(data) ? data : [];
        console.log(chalk.bold(`\n👤 Accounts (Total: ${accounts.length})\n`));
        if (accounts.length === 0) {
          console.log(chalk.dim('  No accounts found.'));
        } else {
          console.log(`  ${chalk.bold('Platform'.padEnd(12))} ${chalk.bold('Account'.padEnd(24))} ${chalk.bold('Status'.padEnd(12))} ${chalk.bold('Remaining')}`);
          accounts.forEach((a) => {
            const statusColor = a.status === 'hibernating' ? chalk.yellow : chalk.green;
            const remaining = a.status === 'hibernating' ? `${Math.round(a.remainingTimeMs / 1000)}s` : '-';
            console.log(`  ${chalk.cyan((a.platform || 'unknown').padEnd(12))} ${String(a.accountId).padEnd(24)} ${statusColor((a.status || 'active').padEnd(12))} ${chalk.dim(remaining)}`);
          });
        }
        console.log();
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // xactions admin checkpoints
  const checkpointsCmd = adminCmd
    .command('checkpoints')
    .description('Manage crawl checkpoints (list, resume, pause, retry)');

  checkpointsCmd
    .command('list')
    .description('List crawl checkpoints with filtering and pagination')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('-p, --platform <platform>', 'Filter by platform')
    .option('-t, --target-type <type>', 'Filter by target type')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <limit>', 'Max checkpoints to return', '50')
    .option('-o, --offset <offset>', 'Offset for pagination', '0')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      let prisma;
      try {
        const baseUrl = options.url || process.env.API_URL || process.env.MCP_SERVER_URL || 'http://localhost:3001';
        /** @type {any} */
        let result;

        try {
          const headers = /** @type {Record<string, string>} */ ({});
          if (options.token) headers.Authorization = `Bearer ${options.token}`;
          const qs = new URLSearchParams();
          if (options.platform) qs.set('platform', options.platform);
          if (options.targetType) qs.set('targetType', options.targetType);
          if (options.status) qs.set('status', options.status);
          qs.set('limit', String(options.limit));
          qs.set('offset', String(options.offset));
          const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/checkpoints?${qs}`, { headers });
          if (resp.ok) {
            const body = await resp.json();
            result = body.data || body;
          }
        } catch {
          // Network error; fall through to in-process call
        }

        if (!result) {
          const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
          prisma = sharedPrisma;
          const { listCheckpoints } = await import('../../store/checkpoint-manager.js');
          result = await listCheckpoints({
            platform: options.platform,
            targetType: options.targetType,
            status: options.status,
            limit: parseCliPositiveInt(options.limit, 'limit'),
            offset: parseCliNonNegativeInt(options.offset, 'offset'),
            prisma,
          });
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const checkpoints = Array.isArray(result.checkpoints) ? result.checkpoints : (Array.isArray(result) ? result : []);
        const total = typeof result.total === 'number' ? result.total : checkpoints.length;
        console.log(chalk.bold(`\n🔄 Checkpoints (Total: ${total}, Showing: ${checkpoints.length})\n`));
        if (checkpoints.length === 0) {
          console.log(chalk.dim('  No checkpoints found.'));
        } else {
          console.log(`  ${chalk.bold('ID'.padEnd(28))} ${chalk.bold('Platform'.padEnd(12))} ${chalk.bold('Status'.padEnd(12))} ${chalk.bold('Target')}`);
          checkpoints.forEach((ckpt) => {
            const statusColor =
              ckpt.status === 'running' ? chalk.green :
              ckpt.status === 'paused' ? chalk.yellow :
              ckpt.status === 'failed' ? chalk.red :
              ckpt.status === 'completed' ? chalk.blue : chalk.magenta;
            console.log(`  ${chalk.cyan(String(ckpt.id).slice(0, 26).padEnd(28))} ${(ckpt.platform || '').padEnd(12)} ${statusColor((ckpt.status || 'unknown').padEnd(12))} ${chalk.dim(`${ckpt.targetType || ''}::${ckpt.targetKey || ''}`)}`);
          });
        }
        console.log();
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        await disconnectPrisma(prisma);
      }
    });
}
