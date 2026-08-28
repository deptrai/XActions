// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions team` command group.
 */
import chalk from 'chalk';

export function registerTeamCommand(program) {
// ============================================================================
// 09-N: Team Management
// ============================================================================

const teamCmd = program.command('team').description('Team & multi-user management');

teamCmd.command('create <name>').description('Create a new team').option('-u, --owner <username>', 'Owner username').action(async (name, options) => {
  try {
    const { createTeam } = await import('../../auth/teamManager.js');
    const result = await createTeam(name, options.owner || 'default');
    console.log(chalk.green(`✅ Team "${name}" created (ID: ${result.id})`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

teamCmd.command('invite <teamId> <email>').description('Invite user to team').option('-r, --role <role>', 'Role: admin, member, viewer', 'member').action(async (teamId, email, options) => {
  try {
    const { inviteUser } = await import('../../auth/teamManager.js');
    const result = await inviteUser(teamId, email, options.role);
    console.log(chalk.green(`✅ Invite sent to ${email} as ${options.role}`));
    console.log(chalk.dim(`Token: ${result.token}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

teamCmd.command('members <teamId>').description('List team members').action(async (teamId) => {
  try {
    const { listTeamMembers } = await import('../../auth/teamManager.js');
    const members = await listTeamMembers(teamId);
    if (members.error) { console.error(chalk.red(members.error)); return; }
    members.forEach(m => console.log(`  ${m.role === 'owner' ? '👑' : '👤'} @${m.username}  ${chalk.dim(m.role)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

teamCmd.command('activity <teamId>').description('View team activity log').option('-l, --limit <n>', 'Max entries', '20').action(async (teamId, options) => {
  try {
    const { getActivityLog } = await import('../../auth/teamManager.js');
    const log = await getActivityLog(teamId, { limit: parseInt(options.limit) });
    log.forEach(a => console.log(`  ${chalk.dim(a.timestamp.split('T')[0])} @${chalk.blue(a.user)} ${a.action} ${JSON.stringify(a.target)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

}
