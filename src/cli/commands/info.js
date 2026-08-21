// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions info` and `xactions status`.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';

/**
 * Register the info and status commands.
 *
 * @param {import('commander').Command} program
 */
export function registerInfoCommands(program) {
  program
    .command('info')
    .description('Show XActions information')
    .action(() => {
      console.log(`
${chalk.bold.cyan('⚡ XActions')} ${chalk.gray('v3.0.0')}

${chalk.bold('The Complete X/Twitter Automation Toolkit')}

${chalk.cyan('Features:')}
  • Scrape profiles, followers, following, tweets
  • Search tweets and hashtags
  • Extract threads, media, and more
  • Export to JSON or CSV
  • No Twitter API required (saves $100-$5000+/mo)

${chalk.cyan('Author:')}
  nich (@nichxbt) - https://github.com/nirholas

${chalk.cyan('Links:')}
  Website:  https://xactions.app
  GitHub:   https://github.com/nirholas/xactions
  Docs:     https://xactions.app/docs

${chalk.yellow('Run "xactions --help" for all commands')}
`);
    });

  program
    .command('status')
    .description('Show system and rate governor status (proxies, throttling, hibernation)')
    .option('--json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const { globalStatusApi, globalAdaptiveRateGovernor } = await import('../../core/index.js');
        const { refreshGovernorConsumerLag, globalStreamMetricsReader } = await import('../../utils/stream-metrics.js');
        await refreshGovernorConsumerLag(globalAdaptiveRateGovernor, globalStreamMetricsReader);
        const status = globalStatusApi.getGovernorStatus();
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        const throttleColor =
          status.throttleLevel === 'normal' ? chalk.green :
          status.throttleLevel === 'reduced' ? chalk.yellow :
          status.throttleLevel === 'backpressure' ? chalk.magenta : chalk.red;

        console.log(`\n${chalk.bold.cyan('⚡ XActions System & Governor Status')}\n`);
        console.log(`  ${chalk.bold('Throttle Level:')}       ${throttleColor(status.throttleLevel)}`);
        console.log(`  ${chalk.bold('Healthy Proxies:')}      ${status.healthyProxyCount} / ${status.totalProxyCount} (${(status.healthyProxyRatio * 100).toFixed(1)}%)`);
        console.log(`  ${chalk.bold('Current Req/Sec:')}      ${status.currentReqPerSecond}`);
        console.log(`  ${chalk.bold('Redis Consumer Lag:')}   ${status.redisConsumerLag}`);
        console.log(`  ${chalk.bold('Hibernating Accounts:')} ${status.hibernatingAccounts.length}`);
        if (status.hibernatingAccounts.length > 0) {
          status.hibernatingAccounts.forEach((acc) => {
            console.log(`    • ${chalk.yellow(acc.accountId)} — ${acc.remainingSeconds}s remaining (${acc.reason})`);
          });
        }
        console.log();
      } catch (err) {
        console.error(chalk.red(`❌ Error retrieving status: ${err?.message || String(err)}`));
        process.exitCode = 1;
      }
    });
}
