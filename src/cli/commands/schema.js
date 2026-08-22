// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions schema` command group.
 */
import chalk from 'chalk';

export function registerSchemaCommand(program) {
// ============================================================================
// 10-5: Schema Contract Registry (Metadata)
// ============================================================================

const schemaCmd = program.command('schema')
  .description('Manage JSON metadata schemas');

schemaCmd.command('list')
  .description('List all registered schemas')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const { metadataSchemaRegistry } = await import('../../core/index.js');
      const schemas = metadataSchemaRegistry.listSchemas();
      if (options.json) {
        console.log(JSON.stringify(schemas, null, 2));
      } else {
        if (schemas.length === 0) {
          console.log(chalk.dim('No schemas registered.'));
          return;
        }
        console.log(chalk.bold(`Registered Schemas (${schemas.length}):`));
        schemas.forEach(s => {
          console.log(`  • ${chalk.cyan(s.platform)} / ${chalk.green(s.category)}`);
        });
      }
    } catch (error) {
      printCliError(error, options);
    }
  });

schemaCmd.command('get <platform> <category>')
  .description('Get JSON schema definition for a platform and category')
  .option('--json', 'Output as JSON')
  .action(async (platform, category, options) => {
    try {
      const { metadataSchemaRegistry } = await import('../../core/index.js');
      const schema = metadataSchemaRegistry.getSchema(platform, category);
      if (!schema) {
        const { PlatformError, ErrorTypes } = await import('../../core/error-envelope.js');
        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_4041',
          message: `Schema not found for platform: ${platform}, category: ${category}`,
          statusCode: 404
        });
      }
      
      if (options.json) {
        console.log(JSON.stringify(schema, null, 2));
      } else {
        console.log(chalk.bold(`Schema: ${platform} / ${category}`));
        console.log(JSON.stringify(schema, null, 2));
      }
    } catch (error) {
      printCliError(error, options);
    }
  });

}
