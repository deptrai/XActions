// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions canary` command group — selector drift detection & GitOps healing.
 * Subcommands: status | probe | heal.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { fileURLToPath } from 'node:url';
import { printCliError } from '../shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../config/canary-targets.json');

function loadTargetsConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

export function registerCanaryCommand(program) {
  const canary = program
    .command('canary')
    .description('Selector drift canary — status, probe, and GitOps healing');

  // --- status ---
  canary
    .command('status')
    .description('Display platformDrift status for all platforms from the governor')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const { globalAdaptiveRateGovernor } = await import('../../core/adaptive-governor.js');
        const status = globalAdaptiveRateGovernor.getStatus?.() || {};
        const drift = status.platformDrift || {};
        if (options.json) {
          console.log(JSON.stringify(drift, null, 2));
          return;
        }
        const platforms = Object.keys(drift);
        if (platforms.length === 0) {
          console.log(chalk.dim('No platformDrift entries — run `xactions canary probe` first.'));
          return;
        }
        console.log(chalk.bold('\n🐤 Selector Canary — Drift Status\n'));
        for (const platform of platforms) {
          const d = drift[platform] || {};
          const rate = typeof d.successRate === 'number' ? `${Math.round(d.successRate * 100)}%` : 'n/a';
          const alertIcon = d.alert ? chalk.red('🚨') : chalk.green('✅');
          console.log(
            `  ${alertIcon} ${chalk.cyan(platform.padEnd(10))} ` +
            `successRate=${chalk.yellow(rate)} ` +
            `consecutiveFailures=${d.consecutiveFailures ?? 0} ` +
            `lastProbe=${chalk.dim(d.lastProbe || 'n/a')}`
          );
          if (d.lastWorkingSelector) {
            console.log(`     ↳ lastWorking: ${chalk.dim(d.lastWorkingSelector)}`);
          }
        }
        console.log('');
      } catch (err) {
        printCliError(err);
        process.exitCode = 1;
      }
    });

  // --- probe ---
  canary
    .command('probe')
    .description('Run a single SelectorCanary probe cycle across configured targets')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const { SelectorCanary } = await import('../../services/selector-canary.js');
        const canary = new SelectorCanary();
        const results = await canary.runOnce();
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }
        const platforms = Object.keys(results || {});
        if (platforms.length === 0) {
          console.log(chalk.dim('No platforms probed.'));
          return;
        }
        console.log(chalk.bold('\n🐤 Canary Probe Results\n'));
        for (const p of platforms) {
          const r = results[p];
          const icon = r.driftDetected ? chalk.yellow('⚠️ ') : chalk.green('✅');
          console.log(
            `  ${icon} ${chalk.cyan(p.padEnd(10))} successRate=${chalk.yellow(Math.round((r.successRate || 0) * 100) + '%')} ` +
            `drift=${r.driftDetected ? 'yes' : 'no'} fallback=${r.usedFallback ? 'yes' : 'no'}`
          );
        }
        console.log('');
      } catch (err) {
        printCliError(err);
        process.exitCode = 1;
      }
    });

  // --- heal ---
  canary
    .command('heal')
    .description('Heal drifted selectors via GitOps Draft PR (manual trigger)')
    .option('--platform <platform>', 'Platform to heal (twitter|facebook|youtube|threads)')
    .option('--target <target>', 'Target name inside platform (e.g. twitter-profile)')
    .option('--preview', 'Print unified-diff to stdout, do not create PR')
    .option('--output <path>', 'Write patch file instead of PR')
    .option('--json', 'Emit structured JSON result')
    .action(async (options) => {
      try {
        const config = loadTargetsConfig();
        if (!config) {
          console.error(chalk.red('❌ canary-targets.json not found or invalid.'));
          process.exitCode = 1;
          return;
        }

        const { CanaryHealer } = await import('../../services/canary-healer.js');
        const healer = new CanaryHealer({});

        const jobs = [];
        if (options.platform && options.target) {
          jobs.push({ platform: options.platform, target: options.target });
        } else if (options.platform && !options.target) {
          const arr = config[options.platform];
          if (!Array.isArray(arr) || arr.length === 0) {
            console.error(chalk.red(`❌ Unknown platform or target: ${options.platform}`));
            process.exitCode = 1;
            return;
          }
          for (const t of arr) jobs.push({ platform: options.platform, target: t.name });
        } else if (!options.platform && !options.target) {
          for (const platform of Object.keys(config)) {
            for (const t of config[platform] || []) {
              if (t && t.name) jobs.push({ platform, target: t.name });
            }
          }
        } else {
          console.error(chalk.red('❌ --target requires --platform.'));
          process.exitCode = 1;
          return;
        }

        const results = [];
        for (const job of jobs) {
          try {
            const res = await healer.heal(job.platform, job.target, {
              preview: options.preview,
              output: options.output,
            });
            results.push(res);
            if (options.json) continue;

            if (res.status === 'preview') {
              console.log(chalk.bold(`\n📋 Preview patch for ${job.platform}/${job.target}:\n`));
              process.stdout.write(res.patch);
            } else if (res.status === 'draft-pr') {
              console.log(chalk.green(`✅ Draft PR created for ${job.platform}/${job.target}: ${res.prUrl}`));
            } else if (res.status === 'patch-file') {
              console.log(chalk.yellow(`📦 Patch file written for ${job.platform}/${job.target}: ${res.patchFile}`));
              if (res.message) console.log(chalk.dim(`   ${res.message}`));
            } else if (res.status === 'no-candidates') {
              console.log(chalk.yellow(`⚠️  No valid replacement selectors found for ${job.platform}/${job.target}`));
              if (res.issueUrl) console.log(chalk.dim(`   Issue filed: ${res.issueUrl}`));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ platform: job.platform, target: job.target, status: 'error', message: msg });
            if (!options.json) {
              console.error(chalk.red(`❌ ${job.platform}/${job.target}: ${msg}`));
            }
          }
        }

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        }
      } catch (err) {
        printCliError(err);
        process.exitCode = 1;
      }
    });
}
