// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions crm` command group.
 */
import chalk from 'chalk';
import ora from 'ora';

export function registerCrmCommand(program) {
// ============================================================================
// 09-C: Follower CRM
// ============================================================================

const crmCmd = program.command('crm').description('Follower CRM — tags, scores, segments');

crmCmd.command('sync <username>').description('Sync followers to CRM').action(async (username) => {
  try {
    const { syncFollowers } = await import('../../analytics/followerCRM.js');
    const spin = ora('Syncing followers...').start();
    const result = await syncFollowers(username);
    spin.succeed(`Synced: ${result.added} added, ${result.updated} updated`);
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('tag <username> <tag>').description('Tag a contact').action(async (username, tag) => {
  try {
    const { tagContact } = await import('../../analytics/followerCRM.js');
    tagContact(username, tag);
    console.log(chalk.green(`✅ Tagged @${username} with "${tag}"`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('search <query>').description('Search contacts').action(async (query) => {
  try {
    const { searchContacts } = await import('../../analytics/followerCRM.js');
    const results = searchContacts(query);
    console.log(JSON.stringify(results.slice(0, 20), null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('score').description('Auto-score all contacts').action(async () => {
  try {
    const { autoScore } = await import('../../analytics/followerCRM.js');
    const result = autoScore();
    console.log(chalk.green(`✅ Scored ${result.scored} contacts`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('segment <name>').description('Get segment members').action(async (name) => {
  try {
    const { getSegment } = await import('../../analytics/followerCRM.js');
    const members = getSegment(name);
    console.log(JSON.stringify(members, null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

}
