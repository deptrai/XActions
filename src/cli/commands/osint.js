// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import chalk from 'chalk';
import { executeSocialFindProfiles } from '../../mcp/osint-find-profiles.js';

/**
 * `xactions osint` command group — OSINT find profiles fan-out.
 * @param {import('commander').Command} program
 */
export function registerOsintCommand(program) {
  const osint = program
    .command('osint')
    .description('OSINT find profiles — fan-out query across platforms (Epic 36)');

  // xactions osint find-profiles
  osint
    .command('find-profiles')
    .description('Execute OSINT find profiles fan-out query')
    .requiredOption('-q, --query <string>', 'Search query (username, name, phone, email)')
    .option('-t, --type <type>', 'Query type: auto|username|name|phone|email', 'auto')
    .option('-p, --platforms <list>', 'Comma-separated platforms (default: all)', '')
    .option('-a, --account <id>', 'Optional account ID for health guard', '')
    .option('-l, --locale <locale>', 'Locale hint (default: en)', 'en')
    .option('--timeout <ms>', 'Per-platform timeout in ms', '')
    .option('--json', 'Output raw JSON', false)
    .action(async (opts) => {
      try {
        const platforms = opts.platforms ? opts.platforms.split(',').map(p => p.trim()) : undefined;
        const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : undefined;

        console.log(chalk.dim(`🔍 OSINT query: "${opts.query}" (type: ${opts.type})`));
        if (platforms) console.log(chalk.dim(`   Platforms: ${platforms.join(', ')}`));
        if (opts.account) console.log(chalk.dim(`   Account: ${opts.account}`));
        console.log('');

        const result = await executeSocialFindProfiles({
          query: opts.query,
          queryType: opts.type,
          platforms,
          accountId: opts.account || undefined,
          locale: opts.locale,
          timeoutMs,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Pretty print results
        console.log(chalk.bold('📊 Platform Status:'));
        console.log('');
        for (const s of result.platformStatus || []) {
          const statusColor = s.status === 'ok' ? chalk.green : 
                             (s.status === 'account_sick' ? chalk.yellow : chalk.red);
          const statusIcon = s.status === 'ok' ? '✅' : 
                            (s.status === 'account_sick' ? '⚠️' : '❌');
          console.log(`   ${statusIcon} ${s.platform.padEnd(15)} ${statusColor(s.status)} ${s.error ? `(${s.error.category})` : ''} ${s.durationMs}ms`);
        }
        console.log('');

        if (result.profiles && result.profiles.length > 0) {
          console.log(chalk.bold('👤 Profiles Found:'));
          console.log('');
          for (const p of result.profiles) {
            console.log(`   • ${p.platform} — ${p.username} (${p.name})`);
            if (p.bio) console.log(`     ${p.bio}`);
            if (p.followersCount) console.log(`     Followers: ${p.followersCount}`);
            if (p.profileUrl) console.log(`     ${p.profileUrl}`);
            console.log('');
          }
        } else {
          console.log(chalk.dim('   No profiles found.'));
        }

      } catch (err) {
        console.error(chalk.red(`❌ OSINT query failed: ${err.message}`));
        process.exit(1);
      }
    });

  // xactions osint platforms
  osint
    .command('platforms')
    .description('List supported platforms for OSINT queries')
    .action(async () => {
      try {
        const { PROFILE_ACTION_MAP } = await import('../../mcp/osint-find-profiles.js');
        const platforms = Object.keys(PROFILE_ACTION_MAP);
        
        console.log(chalk.bold('🌐 Supported Platforms:'));
        console.log('');
        for (const p of platforms) {
          const actions = PROFILE_ACTION_MAP[p];
          const supported = Object.keys(actions).join(', ');
          console.log(`   • ${p.padEnd(15)} → ${supported}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`❌ Failed to list platforms: ${err.message}`));
        process.exit(1);
      }
    });
}
