// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions compat` command group.
 */
import chalk from 'chalk';
import fs from 'fs/promises';

export function registerCompatCommands(program) {
// ============================================================================
// 09-P: Import/Export Compatibility
// ============================================================================

program
  .command('import <file>')
  .description('Import data from Apify, Phantombuster, or CSV')
  .option('--from <source>', 'Source format: apify, phantombuster, auto', 'auto')
  .option('-o, --output <path>', 'Save normalized output to file')
  .action(async (file, options) => {
    try {
      const { importData } = await import('../../compat/apifyAdapter.js');
      const result = await importData(file, options.from);
      console.log(chalk.green(`✅ Imported ${result.items.length} items (type: ${result.type})`));
      if (result.unmappedFields?.length) {
        console.log(chalk.yellow(`⚠️  Unmapped fields: ${result.unmappedFields.join(', ')}`));
      }
      if (options.output) {
        const fs = await import('fs/promises');
        await fs.writeFile(options.output, JSON.stringify(result.items, null, 2));
        console.log(chalk.green(`Saved to ${options.output}`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('export-data <file>')
  .description('Export data in external tool format')
  .option('--to <target>', 'Target format: apify, phantombuster, socialblade, csv', 'csv')
  .option('--type <type>', 'Data type: profile, tweet, followers', 'profile')
  .option('-o, --output <path>', 'Output file path')
  .action(async (file, options) => {
    try {
      const { exportData } = await import('../../compat/apifyAdapter.js');
      const fs = await import('fs/promises');
      const data = JSON.parse(await fs.readFile(file, 'utf-8'));
      const output = exportData(data, options.to, options.type);
      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(chalk.green(`✅ Exported to ${options.output} (${options.to} format)`));
      } else {
        console.log(output);
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('convert <file>')
  .description('Convert between Apify/Phantombuster/CSV formats')
  .option('--from <source>', 'Source: apify, phantombuster', 'apify')
  .option('--to <target>', 'Target: apify, phantombuster, csv', 'csv')
  .option('-o, --output <path>', 'Output file path')
  .action(async (file, options) => {
    try {
      const { convertFormat } = await import('../../compat/apifyAdapter.js');
      const fs = await import('fs/promises');
      const data = await fs.readFile(file, 'utf-8');
      const output = convertFormat(data.startsWith('[') ? JSON.parse(data) : data, options.from, options.to);
      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(chalk.green(`✅ Converted ${options.from} → ${options.to}, saved to ${options.output}`));
      } else {
        console.log(output);
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
