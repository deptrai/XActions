// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions persona` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { loadConfig } from '../shared.js';

export function registerPersonaCommands(program) {
// ============================================================================
// Persona & Algorithm Builder Commands
// ============================================================================

const personaCmd = program
  .command('persona')
  .description('Manage personas for algorithm building & automated growth');

personaCmd
  .command('create')
  .description('Create a new persona with interactive setup')
  .option('--preset <preset>', 'Use a niche preset (crypto-degen, tech-builder, ai-researcher, growth-marketer, finance-investor, creative-writer)')
  .option('--name <name>', 'Persona name')
  .option('--strategy <strategy>', 'Growth strategy (aggressive, moderate, conservative, thoughtleader)')
  .option('--activity <pattern>', 'Activity pattern (night-owl, early-bird, nine-to-five, always-on, weekend-warrior)')
  .action(async (options) => {
    const { createPersona, savePersona, NICHE_PRESETS, ACTIVITY_PATTERNS, ENGAGEMENT_STRATEGIES } = await import('../../personaEngine.js');

    let preset = options.preset;
    let strategy = options.strategy;
    let activityPattern = options.activity;
    let name = options.name;

    // Interactive mode if options not provided
    if (!preset) {
      const presetAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'preset',
        message: '🎯 Choose your niche:',
        choices: Object.entries(NICHE_PRESETS).map(([key, val]) => ({
          name: `${val.name}${val.topics.length ? ' — ' + val.topics.slice(0, 4).join(', ') : ''}`,
          value: key,
        })),
      }]);
      preset = presetAnswer.preset;
    }

    if (!name) {
      const nameAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: '📛 Persona name:',
        default: NICHE_PRESETS[preset]?.name || 'My Persona',
      }]);
      name = nameAnswer.name;
    }

    if (!strategy) {
      const stratAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'strategy',
        message: '📈 Growth strategy:',
        choices: Object.entries(ENGAGEMENT_STRATEGIES).map(([key, val]) => ({
          name: `${val.name} — ${val.description}`,
          value: key,
        })),
      }]);
      strategy = stratAnswer.strategy;
    }

    if (!activityPattern) {
      const actAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'activity',
        message: '🕐 Activity pattern:',
        choices: Object.entries(ACTIVITY_PATTERNS).map(([key, val]) => ({
          name: `${val.name} — ${val.description}`,
          value: key,
        })),
      }]);
      activityPattern = actAnswer.activity;
    }

    // Custom topics if preset is custom
    let customTopics, customSearchTerms, customTargetAccounts;
    if (preset === 'custom') {
      const customAnswers = await inquirer.prompt([
        { type: 'input', name: 'topics', message: '📌 Topics (comma-separated):', },
        { type: 'input', name: 'searchTerms', message: '🔍 Search terms (comma-separated):', },
        { type: 'input', name: 'targetAccounts', message: '🎯 Target accounts to study (comma-separated, no @):', },
        { type: 'input', name: 'tone', message: '🎭 Describe your tone/voice:', default: 'casual, knowledgeable, authentic' },
      ]);
      customTopics = customAnswers.topics.split(',').map(t => t.trim()).filter(Boolean);
      customSearchTerms = customAnswers.searchTerms.split(',').map(t => t.trim()).filter(Boolean);
      customTargetAccounts = customAnswers.targetAccounts.split(',').map(t => t.trim().replace('@', '')).filter(Boolean);
    }

    const persona = createPersona({
      name,
      preset,
      strategy,
      activityPattern,
      topics: customTopics,
      searchTerms: customSearchTerms,
      targetAccounts: customTargetAccounts,
    });

    const filePath = savePersona(persona);
    console.log(chalk.green(`\n✅ Persona "${persona.name}" created!`));
    console.log(chalk.gray(`   ID: ${persona.id}`));
    console.log(chalk.gray(`   Preset: ${preset}`));
    console.log(chalk.gray(`   Strategy: ${strategy}`));
    console.log(chalk.gray(`   Activity: ${activityPattern}`));
    console.log(chalk.gray(`   Topics: ${persona.niche.topics.join(', ')}`));
    console.log(chalk.gray(`   Saved to: ${filePath}`));
    console.log(chalk.cyan(`\n🚀 Start with: xactions persona run ${persona.id}\n`));
  });

personaCmd
  .command('list')
  .description('List all saved personas')
  .action(async () => {
    const { listPersonas } = await import('../../personaEngine.js');
    const personas = listPersonas();

    if (personas.length === 0) {
      console.log(chalk.yellow('No personas found. Create one with: xactions persona create'));
      return;
    }

    console.log(chalk.bold('\n🤖 Saved Personas\n'));
    for (const p of personas) {
      const status = p.lastSessionAt ? chalk.green('●') : chalk.gray('○');
      console.log(`  ${status} ${chalk.bold(p.name)} ${chalk.gray(`(${p.id})`)}`);
      console.log(`    Preset: ${p.preset} | Strategy: ${p.strategy}`);
      console.log(`    Sessions: ${p.totalSessions} | Follows: ${p.totalFollows || 0} | Likes: ${p.totalLikes || 0} | Comments: ${p.totalComments || 0}`);
      if (p.lastSessionAt) {
        console.log(`    Last active: ${new Date(p.lastSessionAt).toLocaleString()}`);
      }
      console.log();
    }
  });

personaCmd
  .command('run <personaId>')
  .description('Start the algorithm builder for a persona (runs 24/7)')
  .option('--headless', 'Run in headless mode (default)', true)
  .option('--no-headless', 'Run with visible browser')
  .option('--dry-run', 'Preview actions without executing')
  .option('--sessions <n>', 'Stop after N sessions (0 = infinite)', '0')
  .option('--token <token>', 'X auth token (overrides saved config)')
  .action(async (personaId, options) => {
    const config = await loadConfig();
    const token = options.token || config.authToken || process.env.XACTIONS_SESSION_COOKIE;

    if (!token) {
      console.error(chalk.red('❌ No auth token. Run "xactions login" first, pass --token, or set XACTIONS_SESSION_COOKIE'));
      return;
    }

    console.log(chalk.bold.cyan('\n🤖 XActions Algorithm Builder\n'));
    console.log(chalk.gray('Press Ctrl+C to stop gracefully\n'));

    try {
      const { startAlgorithmBuilder } = await import('../../algorithmBuilder.js');

      await startAlgorithmBuilder({
        personaId,
        authToken: token,
        headless: options.headless,
        dryRun: options.dryRun,
        maxSessions: parseInt(options.sessions),
        onSessionComplete: ({ persona, stats, sessionCount }) => {
          console.log(chalk.green(`\n✅ Session #${sessionCount} complete`));
          console.log(chalk.gray(`   Total: ${persona.state.totalLikes} likes, ${persona.state.totalFollows} follows, ${persona.state.totalComments} comments, ${persona.state.totalPosts} posts`));
        },
      });
    } catch (error) {
      console.error(chalk.red(`\n❌ ${error.message}`));
    }
  });

personaCmd
  .command('status <personaId>')
  .description('Show detailed status and stats for a persona')
  .action(async (personaId) => {
    try {
      const { loadPersona } = await import('../../personaEngine.js');
      const persona = loadPersona(personaId);

      console.log(chalk.bold(`\n🤖 ${persona.name} — Status Report\n`));
      console.log(chalk.cyan('Identity'));
      console.log(`  ID: ${persona.id}`);
      console.log(`  Preset: ${persona.preset}`);
      console.log(`  Created: ${new Date(persona.createdAt).toLocaleString()}`);
      console.log();

      console.log(chalk.cyan('Niche'));
      console.log(`  Topics: ${persona.niche.topics.join(', ')}`);
      console.log(`  Search terms: ${persona.niche.searchTerms.length}`);
      console.log(`  Target accounts: ${persona.niche.targetAccounts.join(', ') || 'none'}`);
      console.log();

      console.log(chalk.cyan('Strategy'));
      console.log(`  Growth: ${persona.strategy.preset}`);
      console.log(`  Activity: ${persona.activityPattern.preset}`);
      console.log(`  Daily limits: ${persona.strategy.dailyLimits.follows} follows, ${persona.strategy.dailyLimits.likes} likes, ${persona.strategy.dailyLimits.comments} comments`);
      console.log();

      console.log(chalk.cyan('Lifetime Stats'));
      console.log(`  Sessions: ${persona.state.totalSessions}`);
      console.log(`  Follows: ${persona.state.totalFollows}`);
      console.log(`  Likes: ${persona.state.totalLikes}`);
      console.log(`  Comments: ${persona.state.totalComments}`);
      console.log(`  Posts: ${persona.state.totalPosts}`);
      console.log(`  Searches: ${persona.state.totalSearches}`);
      console.log(`  Last active: ${persona.state.lastSessionAt ? new Date(persona.state.lastSessionAt).toLocaleString() : 'never'}`);
      console.log();

      const followedCount = Object.keys(persona.state.followedUsers || {}).length;
      console.log(chalk.cyan('Follow Graph'));
      console.log(`  Users followed: ${followedCount}`);
      console.log(`  Current followers: ${persona.state.currentFollowers}`);
      console.log(`  Target: ${persona.goals.targetFollowers.toLocaleString()}`);
      console.log();
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
    }
  });

personaCmd
  .command('delete <personaId>')
  .description('Delete a saved persona')
  .action(async (personaId) => {
    try {
      const { deletePersona } = await import('../../personaEngine.js');
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete persona ${personaId}? This cannot be undone.`,
        default: false,
      }]);

      if (confirm) {
        deletePersona(personaId);
        console.log(chalk.green(`✅ Persona ${personaId} deleted`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
    }
  });

personaCmd
  .command('edit <personaId>')
  .description('Edit persona configuration')
  .option('--topics <topics>', 'Set topics (comma-separated)')
  .option('--search-terms <terms>', 'Set search terms (comma-separated)')
  .option('--target-accounts <accounts>', 'Set target accounts (comma-separated)')
  .option('--strategy <strategy>', 'Set growth strategy')
  .option('--activity <pattern>', 'Set activity pattern')
  .action(async (personaId, options) => {
    try {
      const { loadPersona, savePersona, ENGAGEMENT_STRATEGIES, ACTIVITY_PATTERNS } = await import('../../personaEngine.js');
      const persona = loadPersona(personaId);

      if (options.topics) {
        persona.niche.topics = options.topics.split(',').map(t => t.trim());
      }
      if (options.searchTerms) {
        persona.niche.searchTerms = options.searchTerms.split(',').map(t => t.trim());
      }
      if (options.targetAccounts) {
        persona.niche.targetAccounts = options.targetAccounts.split(',').map(t => t.trim().replace('@', ''));
      }
      if (options.strategy && ENGAGEMENT_STRATEGIES[options.strategy]) {
        persona.strategy = { preset: options.strategy, ...ENGAGEMENT_STRATEGIES[options.strategy] };
      }
      if (options.activity && ACTIVITY_PATTERNS[options.activity]) {
        persona.activityPattern = { preset: options.activity, ...ACTIVITY_PATTERNS[options.activity] };
      }

      persona.updatedAt = new Date().toISOString();
      savePersona(persona);
      console.log(chalk.green(`✅ Persona "${persona.name}" updated`));
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
    }
  });

}
