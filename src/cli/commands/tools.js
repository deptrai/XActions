// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions tools` command group.
 * Provides developer tools like suggest-selector for assisted selector re-discovery.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import chalk from 'chalk';
import { printCliError } from '../shared.js';

export function registerToolsCommand(program) {
  const toolsCmd = program
    .command('tools')
    .description('Developer and diagnostic tools');

  toolsCmd
    .command('suggest-selector')
    .description('Suggest replacement DOM selectors for a platform field using live page analysis')
    .requiredOption('--platform <platform>', 'Target platform (e.g. twitter, facebook, youtube, threads)')
    .requiredOption('--url <url>', 'Target page URL to probe')
    .requiredOption('--field <field>', 'Field name (resolved via FIELD_SHAPES or as literal data-testid)')
    .option('--backend <backend>', 'Browser backend (obscura or chrome)', 'obscura')
    .option('--json', 'Output results as JSON')
    .action(async (options) => {
      try {
        const { suggestSelectors } = await import('../../core/auto-selector-fallback.js');
        const candidates = await suggestSelectors(
          options.platform,
          options.url,
          options.field,
          {
            backend: options.backend,
          }
        );

        if (options.json) {
          console.log(JSON.stringify(candidates, null, 2));
          return;
        }

        if (!candidates || candidates.length === 0) {
          console.log(chalk.yellow(`No candidate selectors found for field "${options.field}" on ${options.url}`));
          return;
        }

        console.log(chalk.bold(`\n🎯 Candidate Selectors for ${chalk.cyan(options.platform)} / ${chalk.green(options.field)}:\n`));
        candidates.forEach((c, i) => {
          const scoreColor =
            c.confidenceScore >= 0.9 ? chalk.green :
            c.confidenceScore >= 0.7 ? chalk.yellow : chalk.dim;
          console.log(
            `  ${chalk.dim(String(i + 1).padStart(2))}. ${chalk.bold(c.selector)} ` +
            `(${scoreColor(`${Math.round(c.confidenceScore * 100)}%`)}, strategy: ${chalk.cyan(c.strategy)}, matchedOn: ${chalk.dim(c.matchedOn)})`
          );
          if (c.snippet) {
            console.log(`      ${chalk.gray(c.snippet.replace(/\s+/g, ' ').slice(0, 100))}`);
          }
        });
        console.log();
      } catch (error) {
        printCliError(error, options);
      }
    });
}
