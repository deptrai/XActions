// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions plugin` — manage plugins.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import ora from 'ora';

/**
 * Register the plugin command group.
 *
 * @param {import('commander').Command} program
 */
export function registerPluginCommand(program) {
  const pluginCmd = program
    .command('plugin')
    .description('Manage XActions plugins');

  pluginCmd
    .command('install <name>')
    .description('Install a plugin (npm package name or local path)')
    .action(async (name) => {
      const spinner = ora(`Installing plugin "${name}"`).start();
      try {
        const { installPlugin } = await import('../../plugins/manager.js');
        const info = await installPlugin(name);
        spinner.succeed(`Installed plugin "${info.name}" v${info.version}`);
        console.log(chalk.gray(`  ${info.description || ''}`));
        if (info.tools) console.log(chalk.cyan(`  MCP tools: ${info.tools}`));
        if (info.scrapers) console.log(chalk.cyan(`  Scrapers: ${info.scrapers}`));
        if (info.routes) console.log(chalk.cyan(`  API routes: ${info.routes}`));
        if (info.actions) console.log(chalk.cyan(`  Browser actions: ${info.actions}`));
      } catch (error) {
        spinner.fail(`Failed to install plugin "${name}"`);
        console.error(chalk.red(error.message));
      }
    });

  pluginCmd
    .command('remove <name>')
    .description('Remove an installed plugin')
    .action(async (name) => {
      const spinner = ora(`Removing plugin "${name}"`).start();
      try {
        const { removePlugin } = await import('../../plugins/manager.js');
        await removePlugin(name);
        spinner.succeed(`Removed plugin "${name}"`);
      } catch (error) {
        spinner.fail(`Failed to remove plugin "${name}"`);
        console.error(chalk.red(error.message));
      }
    });

  pluginCmd
    .command('list')
    .description('List installed plugins')
    .action(async () => {
      try {
        const { listPlugins } = await import('../../plugins/manager.js');
        const plugins = await listPlugins();

        if (plugins.length === 0) {
          console.log(chalk.gray('\n  No plugins installed.'));
          console.log(chalk.gray('  Install one with: xactions plugin install <name>\n'));
          return;
        }

        console.log(chalk.bold.cyan('\n⚡ Installed Plugins\n'));
        for (const p of plugins) {
          const status = p.enabled
            ? chalk.green('● enabled')
            : chalk.gray('○ disabled');
          console.log(`  ${status}  ${chalk.bold(p.name)} ${chalk.gray('v' + p.version)}`);
          if (p.description) console.log(`         ${chalk.gray(p.description)}`);
        }
        console.log('');
      } catch (error) {
        console.error(chalk.red('Failed to list plugins: ' + error.message));
      }
    });

  pluginCmd
    .command('enable <name>')
    .description('Enable a disabled plugin')
    .action(async (name) => {
      try {
        const { enablePlugin } = await import('../../plugins/manager.js');
        await enablePlugin(name);
        console.log(chalk.green(`✓ Plugin "${name}" enabled`));
      } catch (error) {
        console.error(chalk.red(error.message));
      }
    });

  pluginCmd
    .command('disable <name>')
    .description('Disable a plugin without removing it')
    .action(async (name) => {
      try {
        const { disablePlugin } = await import('../../plugins/manager.js');
        await disablePlugin(name);
        console.log(chalk.green(`✓ Plugin "${name}" disabled`));
      } catch (error) {
        console.error(chalk.red(error.message));
      }
    });

  pluginCmd
    .command('discover')
    .description('Discover XActions plugins in node_modules')
    .action(async () => {
      const spinner = ora('Scanning node_modules...').start();
      try {
        const { discoverPlugins } = await import('../../plugins/loader.js');
        const found = await discoverPlugins();

        if (found.length === 0) {
          spinner.info('No XActions plugins found in node_modules.');
          console.log(chalk.gray('  Install plugins with: npm install xactions-plugin-<name>'));
        } else {
          spinner.succeed(`Found ${found.length} plugin(s):`);
          for (const name of found) {
            console.log(chalk.cyan(`  • ${name}`));
          }
          console.log(chalk.gray('\n  Install with: xactions plugin install <name>'));
        }
      } catch (error) {
        spinner.fail('Failed to discover plugins');
        console.error(chalk.red(error.message));
      }
    });
}
