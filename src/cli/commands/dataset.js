// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions dataset` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerDatasetCommand(program) {
// ============================================================================
// 09-M: Dataset Management
// ============================================================================

const datasetCmd = program.command('dataset').description('Manage scraping datasets (Apify-style)');

datasetCmd.command('list').description('List all datasets').action(async () => {
  try {
    const { listDatasets } = await import('../../scraping/paginationEngine.js');
    const datasets = await listDatasets();
    if (datasets.length === 0) { console.log(chalk.dim('No datasets')); return; }
    datasets.forEach(d => console.log(`  📦 ${d.name}  ${chalk.dim(`${d.itemCount} items, ${d.size}`)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

datasetCmd.command('export <name>').description('Export dataset').option('-f, --format <format>', 'json, csv, jsonl', 'json').option('-o, --output <path>', 'Output file path').action(async (name, options) => {
  try {
    const { DatasetStore } = await import('../../scraping/paginationEngine.js');
    const ds = new DatasetStore(name);
    const data = await ds.export(options.format);
    if (options.output) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.output, data);
      console.log(chalk.green(`✅ Exported to ${options.output}`));
    } else {
      console.log(data);
    }
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

datasetCmd.command('delete <name>').description('Delete a dataset').action(async (name) => {
  try {
    const { DatasetStore } = await import('../../scraping/paginationEngine.js');
    const ds = new DatasetStore(name);
    await ds.delete();
    console.log(chalk.green(`✅ Dataset "${name}" deleted`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

datasetCmd.command('export-db')
  .description('Export scraped dataset directly from PostgreSQL (streaming JSONL/CSV)')
  .requiredOption('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Export format: jsonl, csv', 'jsonl')
  .option('-p, --platform <platform>', 'Filter by platform (e.g. twitter, facebook, shopee)')
  .option('-k, --keyword <keyword>', 'Filter content by keyword (case-insensitive)')
  .option('--from <date>', 'Filter from crawledAt date (ISO string)')
  .option('--to <date>', 'Filter to crawledAt date (ISO string)')
  .option('-c, --compress', 'Enable Gzip compression (.gz)', false)
  .option('--include-comments', 'Include Comment rows in the export', true)
  .action(async (options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { exportDataset } = await import('../../utils/exporter.js');
      const result = await exportDataset({
        format: options.format,
        outputPath: options.output,
        compress: options.compress,
        platform: options.platform,
        keyword: options.keyword,
        fromDate: options.from,
        toDate: options.to,
        includeComments: options.includeComments,
        prisma,
      });
      console.log(chalk.green(`✅ Export completed: ${result.rowCount} records -> ${result.outputPath} (compressed: ${result.compressed})`));
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exitCode = 1;
    } finally {
      if (prisma) {
        try {
          await prisma.$disconnect();
        } catch {}
      }
    }
  });

}
