// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions admin` command group — status, proxies, accounts, checkpoints, and stream metrics.
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import {
  printCliError,
  printGovernorStatus,
  parseCliPositiveInt,
  parseCliNonNegativeInt,
  disconnectPrismaUnlessShared,
  fetchAdminJson,
  formatProxyList,
  formatAccountList,
  formatCheckpointList,
  resolveBaseUrl,
} from '../shared.js';

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
        const baseUrl = resolveBaseUrl(options.url);
        let status;

        try {
          const result = await fetchAdminJson(`${baseUrl}/api/admin/governor/status`, { token: options.token });
          if (result.ok) {
            status = result.body.status;
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
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
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
        const baseUrl = resolveBaseUrl(options.url);
        let metrics;

        try {
          const result = await fetchAdminJson(`${baseUrl}/metrics/stream`, { token: options.token });
          if (result.ok) {
            metrics = result.body;
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
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
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
        const baseUrl = resolveBaseUrl(options.url);
        let alertStatus;

        try {
          const result = await fetchAdminJson(`${baseUrl}/api/admin/stream/alerts`, { token: options.token });
          if (result.ok) {
            alertStatus = result.body.alerts || result.body;
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
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
      }
    });

  // Helper to register proxies subcommands on either 'proxies' or 'proxy' alias
  const registerProxySubcommands = (cmd) => {
    cmd
      .command('list')
      .description('List all registered proxies with status and partition')
      .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
      .option('--token <token>', 'Bearer token for admin authentication')
      .option('-l, --limit <limit>', 'Max proxies to display', '50')
      .option('-o, --offset <offset>', 'Offset for pagination', '0')
      .option('--json', 'Output raw JSON')
      .action(async (options) => {
        try {
          const baseUrl = resolveBaseUrl(options.url);
          const limit = parseCliPositiveInt(options.limit, 'limit');
          const offset = parseCliNonNegativeInt(options.offset, 'offset');
          /** @type {any} */
          let body;

          try {
            const result = await fetchAdminJson(`${baseUrl}/api/admin/proxies`, { token: options.token });
            if (result.ok) {
              body = result.body;
            } else if (options.url) {
              throw new Error(`Remote proxy list failed: HTTP ${result.status} ${result.statusText}`);
            }
          } catch (err) {
            if (options.url) throw err;
            // Network error; fall through to in-process call
          }

          if (!body) {
            const { globalProxyPool } = await import('../../proxy/proxy-pool.js');
            const proxies = globalProxyPool.listProxies();
            body = {
              success: true,
              totalCount: proxies.length,
              healthyCount: proxies.filter((p) => p.status === 'healthy').length,
              proxies,
            };
          }

          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
            return;
          }

          const allProxies = Array.isArray(body.proxies) ? body.proxies : (Array.isArray(body) ? body : []);
          const proxies = allProxies.slice(offset, offset + limit);
          const total = typeof body.totalCount === 'number' ? body.totalCount : allProxies.length;
          console.log(chalk.bold(`\n🌐 Proxies (Total: ${total}, Showing: ${proxies.length})\n`));
          formatProxyList(proxies);
          console.log();
        } catch (err) {
          printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
        }
      });

    cmd
      .command('quarantine <proxyKey>')
      .description('Manually quarantine a proxy by key')
      .option('-d, --duration <ms>', 'Quarantine duration in milliseconds')
      .option('-r, --reason <reason>', 'Optional reason for quarantine')
      .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
      .option('--token <token>', 'Bearer token for admin authentication')
      .option('--json', 'Output raw JSON')
      .action(async (proxyKey, options) => {
        try {
          const baseUrl = resolveBaseUrl(options.url);
          const durationMs = options.duration ? parseCliPositiveInt(options.duration, 'duration') : undefined;
          /** @type {any} */
          let body;

          try {
            const payload = {
              proxy: proxyKey,
              durationMs,
              reason: options.reason,
            };
            const result = await fetchAdminJson(`${baseUrl}/api/admin/proxies/quarantine`, {
              method: 'POST',
              body: JSON.stringify(payload),
              token: options.token,
            });
            if (result.ok) {
              body = result.body;
            } else if (options.url) {
              const errDetail = typeof result.body === 'object' && result.body?.error ? result.body.error : result.statusText;
              throw new Error(`Remote proxy quarantine failed: HTTP ${result.status} ${errDetail}`);
            }
          } catch (err) {
            if (options.url) throw err;
            // Fall through to in-process call
          }

          if (!body) {
            const { globalProxyPool } = await import('../../proxy/proxy-pool.js');
            globalProxyPool.quarantine(proxyKey, durationMs);
            body = {
              success: true,
              quarantined: proxyKey,
              healthyCount: globalProxyPool.healthyCount,
              totalCount: globalProxyPool.totalCount,
            };
          }

          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
            return;
          }

          console.log(chalk.green(`\n✔ Proxy quarantined: ${chalk.bold(body.quarantined || proxyKey)}`));
          if (options.reason) console.log(chalk.dim(`  Reason: ${options.reason}`));
          if (durationMs) console.log(chalk.dim(`  Duration: ${durationMs}ms`));
          if (typeof body.healthyCount === 'number') {
            console.log(chalk.dim(`  Pool Status: ${body.healthyCount}/${body.totalCount} healthy\n`));
          } else {
            console.log();
          }
        } catch (err) {
          printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
        }
      });

    cmd
      .command('release <proxyKey>')
      .description('Manually release a proxy from quarantine')
      .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
      .option('--token <token>', 'Bearer token for admin authentication')
      .option('--json', 'Output raw JSON')
      .action(async (proxyKey, options) => {
        try {
          const baseUrl = resolveBaseUrl(options.url);
          /** @type {any} */
          let body;

          try {
            const payload = { proxy: proxyKey };
            const result = await fetchAdminJson(`${baseUrl}/api/admin/proxies/release`, {
              method: 'POST',
              body: JSON.stringify(payload),
              token: options.token,
            });
            if (result.ok) {
              body = result.body;
            } else if (options.url) {
              const errDetail = typeof result.body === 'object' && result.body?.error ? result.body.error : result.statusText;
              throw new Error(`Remote proxy release failed: HTTP ${result.status} ${errDetail}`);
            }
          } catch (err) {
            if (options.url) throw err;
            // Fall through to in-process call
          }

          if (!body) {
            const { globalProxyPool } = await import('../../proxy/proxy-pool.js');
            const released = globalProxyPool.release(proxyKey);
            body = {
              success: true,
              released,
              proxy: proxyKey,
              healthyCount: globalProxyPool.healthyCount,
              totalCount: globalProxyPool.totalCount,
            };
          }

          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
            return;
          }

          console.log(chalk.green(`\n✔ Proxy released from quarantine: ${chalk.bold(body.proxy || proxyKey)}`));
          if (typeof body.healthyCount === 'number') {
            console.log(chalk.dim(`  Pool Status: ${body.healthyCount}/${body.totalCount} healthy\n`));
          } else {
            console.log();
          }
        } catch (err) {
          printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
        }
      });
  };

  // xactions admin proxies & alias xactions admin proxy
  const proxiesCmd = adminCmd
    .command('proxies')
    .description('Manage proxy pool (list proxies and pool state)');
  registerProxySubcommands(proxiesCmd);

  const proxyCmd = adminCmd
    .command('proxy')
    .description('Manage proxy pool (alias for proxies)');
  registerProxySubcommands(proxyCmd);

  // Helper to register accounts subcommands on either 'accounts' or 'account' alias
  const registerAccountSubcommands = (cmd) => {
    cmd
      .command('list')
      .description('List all accounts with hibernation status and velocity')
      .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
      .option('--token <token>', 'Bearer token for admin authentication')
      .option('--platform <platform>', 'Filter by platform (twitter, facebook, etc.)')
      .option('-l, --limit <limit>', 'Max accounts to display', '50')
      .option('-o, --offset <offset>', 'Offset for pagination', '0')
      .option('--json', 'Output raw JSON')
      .action(async (options) => {
        try {
          const baseUrl = resolveBaseUrl(options.url);
          const limit = parseCliPositiveInt(options.limit, 'limit');
          const offset = parseCliNonNegativeInt(options.offset, 'offset');
          /** @type {any} */
          let body;

          try {
            const query = options.platform ? `?platform=${encodeURIComponent(options.platform)}` : '';
            const result = await fetchAdminJson(`${baseUrl}/api/admin/accounts${query}`, { token: options.token });
            if (result.ok) {
              body = result.body;
            } else if (options.url) {
              throw new Error(`Remote account list failed: HTTP ${result.status} ${result.statusText}`);
            }
          } catch (err) {
            if (options.url) throw err;
            // Network error; fall through to in-process call
          }

          if (!body) {
            const { globalAccountPool } = await import('../../core/index.js');
            const accounts = globalAccountPool.listAccountDetails(options.platform);
            body = { success: true, total: accounts.length, accounts };
          }

          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
            return;
          }

          const allAccounts = Array.isArray(body.accounts) ? body.accounts : (Array.isArray(body) ? body : []);
          const accounts = allAccounts.slice(offset, offset + limit);
          const total = typeof body.total === 'number' ? body.total : allAccounts.length;
          console.log(chalk.bold(`\n👤 Accounts (Total: ${total}, Showing: ${accounts.length})\n`));
          formatAccountList(accounts);
          console.log();
        } catch (err) {
          printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
        }
      });

    cmd
      .command('wake <accountId>')
      .description('Wake an account from hibernation')
      .option('-p, --platform <platform>', 'Account platform')
      .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
      .option('--token <token>', 'Bearer token for admin authentication')
      .option('--json', 'Output raw JSON')
      .action(async (accountId, options) => {
        try {
          const baseUrl = resolveBaseUrl(options.url);
          /** @type {any} */
          let body;

          try {
            const payload = { accountId, platform: options.platform };
            const result = await fetchAdminJson(`${baseUrl}/api/admin/accounts/wake`, {
              method: 'POST',
              body: JSON.stringify(payload),
              token: options.token,
            });
            if (result.ok) {
              body = result.body;
            } else if (result.status === 409) {
              const errMsg = typeof result.body === 'object' && result.body?.error ? result.body.error : 'Account is not currently in hibernation';
              if (options.json) {
                console.log(JSON.stringify({ success: false, error: errMsg, accountId }, null, 2));
                return;
              }
              console.log(chalk.yellow(`\n⚠️  ${errMsg}\n`));
              return;
            } else if (options.url) {
              const errDetail = typeof result.body === 'object' && result.body?.error ? result.body.error : result.statusText;
              throw new Error(`Remote account wake failed: HTTP ${result.status} ${errDetail}`);
            }
          } catch (err) {
            if (options.url) throw err;
            // Fall through to in-process call
          }

          if (!body) {
            const { globalAccountPool, globalAdaptiveRateGovernor } = await import('../../core/index.js');
            const account = globalAccountPool.getAccount(accountId, options.platform);
            if (!account) {
              throw new Error(`Account "${accountId}" not found`);
            }
            const targetPlatform = options.platform || account.platform;
            const compositeKey = `${targetPlatform}:${accountId}`;
            const isHibernatingRecord = account.hibernatingUntil !== null && account.hibernatingUntil > Date.now();
            const isHibernatingGov = globalAdaptiveRateGovernor.isHibernating(compositeKey) || globalAdaptiveRateGovernor.isHibernating(accountId);

            if (!isHibernatingRecord && !isHibernatingGov) {
              const errMsg = `Account "${accountId}" is not currently in hibernation`;
              if (options.json) {
                console.log(JSON.stringify({ success: false, error: errMsg, accountId }, null, 2));
                return;
              }
              console.log(chalk.yellow(`\n⚠️  ${errMsg}\n`));
              return;
            }

            globalAccountPool.markAvailable(accountId, targetPlatform);
            body = {
              success: true,
              accountId,
              status: 'active',
              message: `Account "${accountId}" is now active`,
            };
          }

          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
            return;
          }

          console.log(chalk.green(`\n✔ Account awakened: ${chalk.bold(body.accountId || accountId)}`));
          console.log(chalk.dim(`  Status: active\n`));
        } catch (err) {
          printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
        }
      });

    cmd
      .command('rotate <accountId> [platform]')
      .description('Rotate to the next available account in the pool')
      .option('-p, --platform <platform>', 'Account platform (alternative to argument)')
      .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
      .option('--token <token>', 'Bearer token for admin authentication')
      .option('--json', 'Output raw JSON')
      .action(async (accountId, platformArg, options) => {
        try {
          const baseUrl = resolveBaseUrl(options.url);
          const platform = platformArg || options.platform;
          /** @type {any} */
          let body;

          try {
            const payload = { accountId, platform };
            const result = await fetchAdminJson(`${baseUrl}/api/admin/accounts/rotate`, {
              method: 'POST',
              body: JSON.stringify(payload),
              token: options.token,
            });
            if (result.ok) {
              body = result.body;
            } else if (options.url) {
              const errDetail = typeof result.body === 'object' && result.body?.error ? result.body.error : result.statusText;
              throw new Error(`Remote account rotate failed: HTTP ${result.status} ${errDetail}`);
            }
          } catch (err) {
            if (options.url) throw err;
            // Fall through to in-process call
          }

          if (!body) {
            const { globalAccountPool } = await import('../../core/index.js');
            const account = globalAccountPool.getAccount(accountId, platform);
            if (!account) {
              throw new Error(`Account "${accountId}" not found`);
            }
            const targetPlatform = platform || account.platform;
            const nextAccountId = globalAccountPool.getNextAvailable(targetPlatform);
            body = {
              success: true,
              previousAccountId: accountId,
              nextAccountId,
              platform: targetPlatform,
            };
          }

          if (options.json) {
            console.log(JSON.stringify(body, null, 2));
            return;
          }

          console.log(chalk.green(`\n✔ Account rotated:`));
          console.log(chalk.dim(`  Previous: ${chalk.bold(body.previousAccountId || accountId)}`));
          console.log(chalk.dim(`  Next:     ${chalk.bold(body.nextAccountId || 'none available')}`));
          if (body.platform) console.log(chalk.dim(`  Platform: ${body.platform}\n`));
          else console.log();
        } catch (err) {
          printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
        }
      });
  };

  // xactions admin accounts & alias xactions admin account
  const accountsCmd = adminCmd
    .command('accounts')
    .description('Manage account pool (list, wake, and rotate accounts)');
  registerAccountSubcommands(accountsCmd);

  const accountCmd = adminCmd
    .command('account')
    .description('Manage account pool (alias for accounts)');
  registerAccountSubcommands(accountCmd);

  // xactions admin checkpoints
  const checkpointsCmd = adminCmd
    .command('checkpoints')
    .description('Manage crawl checkpoints (list checkpoints; other actions planned)');

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
        const baseUrl = resolveBaseUrl(options.url);
        const limit = parseCliPositiveInt(options.limit, 'limit');
        const offset = parseCliNonNegativeInt(options.offset, 'offset');
        /** @type {any} */
        let body;

        try {
          const qs = new URLSearchParams();
          if (options.platform) qs.set('platform', options.platform);
          if (options.targetType) qs.set('targetType', options.targetType);
          if (options.status) qs.set('status', options.status);
          qs.set('limit', String(limit));
          qs.set('offset', String(offset));
          const result = await fetchAdminJson(`${baseUrl}/api/checkpoints?${qs}`, { token: options.token });
          if (result.ok) {
            body = result.body;
          } else if (options.url) {
            throw new Error(`Remote checkpoint list failed: HTTP ${result.status} ${result.statusText}`);
          }
        } catch (err) {
          if (options.url) throw err;
          // Network error; fall through to in-process call
        }

        if (!body) {
          const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
          prisma = sharedPrisma;
          const { listCheckpoints } = await import('../../store/checkpoint-manager.js');
          const result = await listCheckpoints({
            platform: options.platform,
            targetType: options.targetType,
            status: options.status,
            limit,
            offset,
            prisma,
          });
          body = { success: true, data: result };
        }

        if (options.json) {
          console.log(JSON.stringify(body, null, 2));
          return;
        }

        const result = body.data || body;
        formatCheckpointList(result);
        console.log();
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
      } finally {
        await disconnectPrismaUnlessShared(prisma, true);
      }
    });
}
