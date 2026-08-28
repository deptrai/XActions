// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions rss` command group.
 */
import chalk from 'chalk';
import ora from 'ora';

export function registerRssCommand(program) {
// ============================================================================
// 09-I: RSS Monitor
// ============================================================================

const rssCmd = program.command('rss').description('RSS feed monitoring & auto-posting');

rssCmd.command('add <name> <url>').description('Add an RSS feed').option('-t, --template <template>', 'Post template', '📰 {title}\n\n{link}').action(async (name, url, options) => {
  try {
    const { addFeed } = await import('../../automation/rssMonitor.js');
    addFeed({ name, url, template: options.template });
    console.log(chalk.green(`✅ Feed "${name}" added`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

rssCmd.command('list').description('List all feeds').action(async () => {
  try {
    const { listFeeds } = await import('../../automation/rssMonitor.js');
    const feeds = listFeeds();
    if (feeds.length === 0) { console.log(chalk.dim('No feeds configured')); return; }
    feeds.forEach(f => console.log(`  ${f.enabled ? '🟢' : '🔴'} ${f.name}  ${chalk.dim(f.url)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

rssCmd.command('check [name]').description('Check feeds for new items').action(async (name) => {
  try {
    const { checkFeed, checkAllFeeds } = await import('../../automation/rssMonitor.js');
    const spin = ora('Checking feeds...').start();
    const result = name ? await checkFeed(name) : await checkAllFeeds();
    const count = name ? result.newItems : result.reduce((s, r) => s + r.newItems, 0);
    spin.succeed(`Found ${count} new items`);
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

rssCmd.command('drafts').description('View draft posts from feeds').action(async () => {
  try {
    const { getDrafts } = await import('../../automation/rssMonitor.js');
    const drafts = getDrafts();
    if (drafts.length === 0) { console.log(chalk.dim('No drafts')); return; }
    drafts.forEach((d, i) => console.log(`  ${i + 1}. ${chalk.dim(d.text?.substring(0, 80))}...`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

}
