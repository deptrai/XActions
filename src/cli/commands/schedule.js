// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions schedule` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';
import prisma from '../../../api/lib/prisma.js';

export function registerScheduleCommand(program) {
// ============================================================================
// 09-F: Scheduler
// ============================================================================

const schedCmd = program.command('schedule').description('Cron-based task scheduler + tweet scheduling (EPS-2)');

schedCmd.command('add <name> <cron>').description('Add scheduled job').option('-c, --command <cmd>', 'Command to run').action(async (name, cron, options) => {
  try {
    const { getScheduler } = await import('../../scheduler/scheduler.js');
    const scheduler = getScheduler();
    scheduler.addJob({ name, cron, action: options.command || 'echo "Job: ' + name + '"' });
    console.log(chalk.green(`✅ Job "${name}" scheduled: ${cron}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

schedCmd.command('list').description('List scheduled jobs, or tweet schedules when --status is given (EPS-2)').option('--status <status>', 'Filter tweet schedules by status (pending|running|completed|failed|cancelled)').action(async (options) => {
  try {
    // EPS-2: `schedule list --status [status]` lists DB-backed tweet schedules.
    if (options.status !== undefined) {
      const where = { platform: 'twitter' };
      if (options.status) where.status = String(options.status);
      const schedules = await prisma.schedule.findMany({
        where,
        orderBy: [{ queueOrder: 'asc' }, { scheduledAt: 'asc' }],
        take: 100,
      });
      if (schedules.length === 0) { console.log(chalk.dim('No tweet schedules')); return; }
      for (const s of schedules) {
        const when = s.scheduledAt.toISOString().replace('T', ' ').slice(0, 16);
        const tag = s.thread ? 'thread' : 'tweet';
        const recur = s.recurrenceCron ? chalk.dim(` recur="${s.recurrenceCron}"`) : '';
        console.log(`  ${chalk.cyan(s.id)}  ${when}  ${chalk.yellow(s.status.padEnd(9))}  ${tag}${recur}  ${chalk.dim(s.content.slice(0, 50))}`);
      }
      return;
    }
    const { getScheduler } = await import('../../scheduler/scheduler.js');
    const scheduler = getScheduler();
    const jobs = scheduler.listJobs();
    if (jobs.length === 0) { console.log(chalk.dim('No scheduled jobs')); return; }
    jobs.forEach(j => console.log(`  ${j.enabled ? '🟢' : '🔴'} ${j.name}  ${chalk.dim(j.cron)}  ${chalk.dim('Next: ' + (j.nextRun || '—'))}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

schedCmd.command('remove <name>').description('Remove a scheduled job').action(async (name) => {
  try {
    const { getScheduler } = await import('../../scheduler/scheduler.js');
    getScheduler().removeJob(name);
    console.log(chalk.green(`✅ Job "${name}" removed`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

schedCmd.command('run <name>').description('Run a job immediately').action(async (name) => {
  try {
    const { getScheduler } = await import('../../scheduler/scheduler.js');
    await getScheduler().runJobNow(name);
    console.log(chalk.green(`✅ Job "${name}" executed`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

// ── EPS-2 Tweet Scheduling ───────────────────────────────────────────────────
// `schedule create` / `schedule cancel` operate on DB-backed tweet schedules.
// `schedule list --status [status]` (above) lists them. The CLI resolves the
// caller's userId from the stored session cookie (auth_token): an existing User
// row with that cookie is reused; otherwise a CLI-local user is provisioned so
// dryRun:false can persist a Schedule row without the dashboard signup flow.
async function resolveCliUserId() {
  const config = await loadConfig();
  const sessionCookie = config.sessionCookie || process.env.XACTIONS_SESSION_COOKIE;
  if (!sessionCookie) {
    throw new Error('No Twitter session cookie found — run `xactions login` or set XACTIONS_SESSION_COOKIE');
  }
  const existing = await prisma.user.findFirst({ where: { sessionCookie } });
  if (existing) return existing.id;
  // Provision a CLI-local user so scheduled tweets have a stable owner.
  const username = `cli_${sessionCookie.slice(0, 8)}`;
  const user = await prisma.user.upsert({
    where: { username },
    update: { sessionCookie },
    create: { username, sessionCookie, isGuest: true, authMethod: 'cli' },
  });
  return user.id;
}

schedCmd.command('create').description('Schedule a tweet or thread for future publishing (EPS-2). Dry-run by default.')
  .requiredOption('-c, --content <text>', 'Tweet text (first tweet of a thread)')
  .requiredOption('-a, --at <iso>', 'ISO-8601 datetime ≥60s in the future')
  .option('--thread <t2,t3,...>', 'Comma-separated follow-up tweet texts (thread)')
  .option('--tz <timezone>', 'IANA timezone to interpret a wall-clock --at (e.g. Europe/London)')
  .option('--recur <cron>', 'node-cron expression; re-arms the schedule after execution')
  .option('--dry-run <bool>', 'Preview without persisting (default: true; set false to create)', (v) => v === 'false' ? false : true, true)
  .action(async (options) => {
    try {
      const { scheduleTweet } = await import('../../../api/services/tweetScheduling.js');
      const thread = options.thread ? options.thread.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const userId = options.dryRun === false ? await resolveCliUserId() : undefined;
      const result = await scheduleTweet(
        { content: options.content, scheduledAt: options.at, thread, timezone: options.tz, recurrenceCron: options.recur },
        { dryRun: options.dryRun, userId },
      );
      if (result.dryRun) {
        console.log(chalk.cyan('🔍 Dry-run preview (no row persisted):'));
        console.log(`  content:    ${result.preview.content.slice(0, 60)}`);
        console.log(`  scheduledAt:${result.preview.scheduledAt}`);
        if (result.preview.timezone) console.log(`  timezone:   ${result.preview.timezone}`);
        if (result.preview.recurrenceCron) console.log(`  recurrence: ${result.preview.recurrenceCron}`);
        if (result.preview.thread) console.log(`  thread:     ${result.preview.thread.length} follow-up tweet(s)`);
        console.log(chalk.dim(`  set --dry-run false to persist`));
      } else {
        console.log(chalk.green(`✅ Tweet scheduled: ${result.scheduleId} at ${result.scheduledAt} (status: ${result.status})`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

schedCmd.command('cancel <id>').description('Cancel a pending tweet schedule (EPS-2)').action(async (id) => {
  try {
    const claim = await prisma.schedule.updateMany({
      where: { id, platform: 'twitter', status: 'pending' },
      data: { status: 'cancelled' },
    });
    if (claim.count === 0) {
      const existing = await prisma.schedule.findFirst({ where: { id, platform: 'twitter' }, select: { status: true } });
      if (!existing) { console.error(chalk.red(`❌ Schedule ${id} not found`)); return; }
      console.error(chalk.red(`❌ Cannot cancel schedule in status "${existing.status}" (only pending can be cancelled)`));
      return;
    }
    console.log(chalk.green(`✅ Schedule ${id} cancelled`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

}
