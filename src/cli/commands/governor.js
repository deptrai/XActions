// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Rate Governor observability and emergency control commands (Story 32.1).
 *
 * Exposes:
 * - `xactions governor-status`
 * - `xactions panic-stop`
 * - `xactions panic-resume`
 * - `xactions priorities`
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import chalk from 'chalk';
import {
  printCliError,
  printGovernorStatus,
  fetchAdminJson,
  resolveBaseUrl,
} from '../shared.js';

/**
 * Register rate governor commands on the Commander program.
 *
 * @param {import('commander').Command} program
 */
export function registerGovernorCommands(program) {
  // ============================================================================
  // governor-status
  // ============================================================================
  program
    .command('governor-status')
    .description('Display rate governor, proxy health, and account velocity status (Story 32.1)')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const baseUrl = resolveBaseUrl(options.url);
        /** @type {import('../../core/types.js').GovernorStatus | undefined} */
        let status;

        try {
          const result = await fetchAdminJson(`${baseUrl}/api/governor/status`, { token: options.token });
          if (result.ok && result.body?.status) {
            status = /** @type {import('../../core/types.js').GovernorStatus} */ (result.body.status);
          } else {
            const adminRes = await fetchAdminJson(`${baseUrl}/api/admin/governor/status`, { token: options.token });
            if (adminRes.ok && adminRes.body?.status) {
              status = /** @type {import('../../core/types.js').GovernorStatus} */ (adminRes.body.status);
            }
          }
        } catch {
          // Network error or endpoint down; proceed to in-process fallback
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

  // ============================================================================
  // panic-stop
  // ============================================================================
  program
    .command('panic-stop [platform]')
    .description('Activate emergency Panic Stop to hibernate accounts and enforce critical throttle (Story 32.1)')
    .option('-p, --platform <platform>', 'Platform to halt (twitter, bluesky, threads, mastodon, all)', 'all')
    .option('-d, --duration <ms>', 'Duration in milliseconds (default: 3600000 = 1hr)', '3600000')
    .option('-r, --reason <reason>', 'Panic stop reason', 'emergency_panic_stop')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (platformArg, options) => {
      try {
        const platform = platformArg || options.platform || 'all';
        const durationMs = parseInt(options.duration, 10) || 3600000;
        const reason = options.reason || 'emergency_panic_stop';
        const baseUrl = resolveBaseUrl(options.url);

        let result;

        try {
          const remote = await fetchAdminJson(`${baseUrl}/api/governor/panic-stop`, {
            method: 'POST',
            token: options.token,
            body: JSON.stringify({ platform, durationMs, reason }),
          });
          if (remote.ok && remote.body?.result) {
            result = remote.body.result;
          }
        } catch {
          // Remote not reachable; fallback to in-process
        }

        if (!result) {
          const { globalAdaptiveRateGovernor } = await import('../../core/index.js');
          result = globalAdaptiveRateGovernor.panicStop(platform, { durationMs, reason });
        }

        if (options.json) {
          console.log(JSON.stringify({
            success: true,
            message: `Emergency Panic Stop activated for ${platform}`,
            result,
          }, null, 2));
          return;
        }

        console.log(chalk.red.bold(`\n🛑 Emergency Panic Stop Activated for: ${chalk.white(platform)}\n`));
        console.log(`  • ${chalk.cyan('Hibernated Accounts')}: ${chalk.yellow(result.hibernatedCount ?? 0)}`);
        console.log(`  • ${chalk.cyan('Throttle Level')}:      ${chalk.red('critical')}`);
        console.log(`  • ${chalk.cyan('Duration')}:            ${chalk.dim(`${durationMs}ms`)}`);
        console.log(`  • ${chalk.cyan('Reason')}:              ${chalk.dim(reason)}\n`);
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
      }
    });

  // ============================================================================
  // panic-resume
  // ============================================================================
  program
    .command('panic-resume [platform]')
    .description('Resume operations after emergency Panic Stop (Story 32.1)')
    .option('-p, --platform <platform>', 'Platform to resume (twitter, bluesky, threads, mastodon, all)', 'all')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (platformArg, options) => {
      try {
        const platform = platformArg || options.platform || 'all';
        const baseUrl = resolveBaseUrl(options.url);

        let result;

        try {
          const remote = await fetchAdminJson(`${baseUrl}/api/governor/panic-resume`, {
            method: 'POST',
            token: options.token,
            body: JSON.stringify({ platform }),
          });
          if (remote.ok && remote.body?.result) {
            result = remote.body.result;
          }
        } catch {
          // Fallback to in-process
        }

        if (!result) {
          const { globalAdaptiveRateGovernor } = await import('../../core/index.js');
          result = globalAdaptiveRateGovernor.resumePanic(platform);
        }

        if (options.json) {
          console.log(JSON.stringify({
            success: true,
            message: `Panic Stop resumed for ${platform}`,
            result,
          }, null, 2));
          return;
        }

        console.log(chalk.green.bold(`\n✅ Panic Stop Resumed for: ${chalk.white(platform)}\n`));
        if (result.remainingPanics && result.remainingPanics.length > 0) {
          console.log(`  • ${chalk.yellow('Remaining Halted Platforms')}: ${result.remainingPanics.join(', ')}\n`);
        } else {
          console.log(`  • All platforms restored to normal operational state.\n`);
        }
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
      }
    });

  // ============================================================================
  // priorities
  // ============================================================================
  program
    .command('priorities [consumerId] [priority]')
    .description('Inspect or update consumer execution priorities for the rate governor (Story 32.1)')
    .option('--set <pairs...>', 'Update consumer priorities (e.g. --set realtime:1 bulk:3)')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (consumerIdArg, priorityArg, options) => {
      try {
        const baseUrl = resolveBaseUrl(options.url);

        // Collect priorities to update
        /** @type {Array<{ consumerId: string, priority: number }>} */
        const toUpdate = [];

        if (consumerIdArg && priorityArg != null) {
          toUpdate.push({ consumerId: consumerIdArg, priority: Number(priorityArg) });
        }

        if (options.set && Array.isArray(options.set)) {
          for (const pair of options.set) {
            const [cId, prio] = pair.split(':');
            if (cId && prio != null) {
              toUpdate.push({ consumerId: cId.trim(), priority: Number(prio) });
            }
          }
        }

        if (toUpdate.length > 0) {
          let updated = [];
          let consumerQuotas = {};

          try {
            const remote = await fetchAdminJson(`${baseUrl}/api/governor/priorities`, {
              method: 'POST',
              token: options.token,
              body: JSON.stringify({ priorities: toUpdate }),
            });
            if (remote.ok && remote.body) {
              updated = remote.body.updated || [];
              consumerQuotas = remote.body.consumerQuotas || {};
            }
          } catch {
            // Fallback in-process
          }

          if (updated.length === 0) {
            const { globalAdaptiveRateGovernor, globalStatusApi } = await import('../../core/index.js');
            for (const item of toUpdate) {
              const ok = globalAdaptiveRateGovernor.setConsumerPriority(item.consumerId, item.priority);
              if (ok) updated.push(item.consumerId);
            }
            consumerQuotas = globalStatusApi.getGovernorStatus()?.consumerQuotas || {};
          }

          if (options.json) {
            console.log(JSON.stringify({ success: true, updated, consumerQuotas }, null, 2));
            return;
          }

          console.log(chalk.green.bold(`\n✔ Updated Governor Priorities for: ${updated.join(', ')}\n`));
          for (const [id, quota] of Object.entries(consumerQuotas)) {
            console.log(`  • ${chalk.bold(id.padEnd(12))}: Priority ${chalk.yellow(quota.priority ?? 'default')}`);
          }
          console.log();
          return;
        }

        // View current priorities & quotas
        let consumerQuotas;

        try {
          const remote = await fetchAdminJson(`${baseUrl}/api/governor/status`, { token: options.token });
          if (remote.ok && remote.body?.status?.consumerQuotas) {
            consumerQuotas = remote.body.status.consumerQuotas;
          }
        } catch {
          // Fallback
        }

        if (!consumerQuotas) {
          const { globalStatusApi } = await import('../../core/index.js');
          consumerQuotas = globalStatusApi.getGovernorStatus()?.consumerQuotas || {};
        }

        if (options.json) {
          console.log(JSON.stringify(consumerQuotas, null, 2));
          return;
        }

        console.log(chalk.bold(`\n⚖️ Governor Consumer Quotas & Priorities (Story 32.1)\n`));
        const entries = Object.entries(consumerQuotas);
        if (entries.length === 0) {
          console.log(chalk.dim('  No consumers currently registered.\n'));
          return;
        }

        for (const [id, q] of entries) {
          const limit = q.rpmLimit === Infinity ? 'unmetered' : `${q.usedInWindow}/${q.rpmLimit} RPM`;
          const throttled = q.isThrottled ? chalk.red('⛔ throttled') : chalk.green('✅ healthy');
          console.log(`  • ${chalk.bold(id.padEnd(14))} Priority: ${chalk.yellow(q.priority ?? 0)} | ${limit} | ${throttled}`);
        }
        console.log();
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
      }
    });
}
