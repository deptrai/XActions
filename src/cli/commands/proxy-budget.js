// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import chalk from 'chalk';
import { globalProxyBudgetGovernor } from '../../core/proxy-budget-governor.js';

/**
 * `xactions proxy budget` command group — cost-aware proxy escalation & budget ceiling.
 * @param {import('commander').Command} program
 */
export function registerProxyBudgetCommand(program) {
  const proxy = program
    .command('proxy')
    .description('Proxy management — pool, budget, tier, escalation');

  // xactions proxy budget
  proxy
    .command('budget')
    .description('Show current proxy budget status and tier costs')
    .option('--json', 'Output raw JSON', false)
    .action(async (opts) => {
      try {
        const remaining = await globalProxyBudgetGovernor.checkRemaining();
        
        if (opts.json) {
          console.log(JSON.stringify({
            remainingUsd: remaining.remaining,
            dailyBudgetUsd: remaining.dailyBudgetUsd,
            tierCosts: {
              free: 0,
              datacenter: 0.5,
              residential: 8.0,
              mobile_4g: 15.0,
            },
            estimatedCostPerRequestUsd: {
              datacenter: 0.42,
              residential: 0.42,
              mobile_4g: 0.79,
            },
          }, null, 2));
          return;
        }

        console.log(chalk.bold('💰 Proxy Budget Status (Epic 40)'));
        console.log('');
        console.log(`   Daily Budget:     $${remaining.dailyBudgetUsd.toFixed(2)}`);
        console.log(`   Remaining:        $${remaining.remaining.toFixed(2)}`);
        console.log(`   Spent Today:      $${(remaining.dailyBudgetUsd - remaining.remaining).toFixed(2)}`);
        console.log('');
        console.log(chalk.bold('   Tier Costs (per GB):'));
        console.log(`      free         $0.00`);
        console.log(`      datacenter   $0.50`);
        console.log(`      residential  $8.00`);
        console.log(`      mobile_4g   $15.00`);
        console.log('');
        console.log(chalk.bold('   Estimated Cost per Request (~50MB):'));
        console.log(`      datacenter   $0.42`);
        console.log(`      residential  $0.42`);
        console.log(`      mobile_4g   $0.79`);
        console.log('');

      } catch (err) {
        console.error(chalk.red(`❌ Failed to check budget: ${err.message}`));
        process.exit(1);
      }
    });

  // xactions proxy budget reset
  proxy
    .command('budget reset')
    .description('Reset daily proxy budget (admin only)')
    .action(async () => {
      try {
        const cur = await globalProxyBudgetGovernor.checkRemaining();
        if (cur.remaining > 0) {
          await globalProxyBudgetGovernor.consume('datacenter', (cur.remaining / 0.5) * 1e9);
        }
        const after = await globalProxyBudgetGovernor.checkRemaining();
        console.log(chalk.green(`✅ Budget reset. Remaining: $${after.remaining.toFixed(2)}`));
      } catch (err) {
        console.error(chalk.red(`❌ Failed to reset budget: ${err.message}`));
        process.exit(1);
      }
    });
}
