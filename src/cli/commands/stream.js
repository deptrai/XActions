// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions stream` — real-time event streaming.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../shared.js';

/**
 * Register the stream command group.
 *
 * @param {import('commander').Command} program
 */
export function registerStreamCommand(program) {
  const streamCmd = program
    .command('stream')
    .description('Real-time event streaming for X/Twitter accounts');

  streamCmd
    .command('start <type> <username>')
    .description('Start a stream (type: tweet, follower, mention)')
    .option('-i, --interval <seconds>', 'Poll interval in seconds', '60')
    .action(async (type, username, options) => {
      const spinner = ora(`Starting ${type} stream for @${username}`).start();
      try {
        const { createStream } = await import('../../streaming/index.js');
        const config = await loadConfig();
        const stream = await createStream({
          type,
          username,
          interval: parseInt(options.interval, 10) * 1000,
          authToken: config.authToken || undefined,
        });
        spinner.succeed(`Stream started: ${stream.id}`);
        console.log(chalk.gray(`  Type: ${stream.type}`));
        console.log(chalk.gray(`  Username: @${stream.username}`));
        console.log(chalk.gray(`  Interval: ${stream.interval / 1000}s`));
        console.log(chalk.cyan('\n  Events will be emitted via Socket.IO.'));
        console.log(chalk.cyan(`  Room: stream:${stream.id}`));
      } catch (error) {
        spinner.fail('Failed to start stream');
        console.error(chalk.red(error.message));
      }
    });

  streamCmd
    .command('stop <streamId>')
    .description('Stop an active stream')
    .action(async (streamId) => {
      const spinner = ora(`Stopping stream ${streamId}`).start();
      try {
        const { stopStream } = await import('../../streaming/index.js');
        await stopStream(streamId);
        spinner.succeed(`Stream stopped: ${streamId}`);
      } catch (error) {
        spinner.fail('Failed to stop stream');
        console.error(chalk.red(error.message));
      }
    });

  streamCmd
    .command('list')
    .description('List active streams')
    .action(async () => {
      try {
        const { listStreams, getPoolStatus } = await import('../../streaming/index.js');
        const streams = await listStreams();
        const pool = getPoolStatus();

        if (streams.length === 0) {
          console.log(chalk.gray('\n  No active streams.'));
          console.log(chalk.gray('  Start one with: xactions stream start <type> <username>\n'));
          return;
        }

        console.log(chalk.bold.cyan('\n📡 Active Streams\n'));
        for (const s of streams) {
          const statusColor = s.status === 'running' ? chalk.green : chalk.yellow;
          console.log(`  ${statusColor('●')} ${chalk.bold(s.id)}`);
          console.log(`    Type: ${s.type}  User: @${s.username}  Interval: ${s.interval / 1000}s`);
          console.log(`    Status: ${statusColor(s.status)}  Polls: ${s.pollCount}  Errors: ${s.errorCount}`);
          if (s.lastPollAt) console.log(chalk.gray(`    Last poll: ${s.lastPollAt}`));
          console.log('');
        }

        console.log(chalk.gray(`  Browser pool: ${pool.browsers}/${pool.maxBrowsers} browsers`));
        console.log('');
      } catch (error) {
        console.error(chalk.red('Failed to list streams: ' + error.message));
      }
    });

  streamCmd
    .command('history <streamId>')
    .description('Show recent events for a stream')
    .option('-l, --limit <number>', 'Max events', '20')
    .option('-t, --type <eventType>', 'Filter by event type (e.g. stream:tweet)')
    .action(async (streamId, options) => {
      try {
        const { getStreamHistory } = await import('../../streaming/index.js');
        const events = await getStreamHistory(streamId, {
          limit: parseInt(options.limit, 10),
          eventType: options.type,
        });

        if (events.length === 0) {
          console.log(chalk.gray('\n  No events yet for this stream.\n'));
          return;
        }

        console.log(chalk.bold.cyan(`\n📡 Events for ${streamId}\n`));
        for (const e of events) {
          const time = chalk.gray(new Date(e.timestamp).toLocaleTimeString());
          const type = chalk.cyan(e.type);
          console.log(`  ${time} ${type}`);
          if (e.data?.text) console.log(`    ${e.data.text.slice(0, 120)}`);
          if (e.data?.action) console.log(`    ${e.data.action}: ${e.data.follower || e.data.delta || ''}`);
        }
        console.log('');
      } catch (error) {
        console.error(chalk.red('Failed to get history: ' + error.message));
      }
    });

  streamCmd
    .command('pause <streamId>')
    .description('Pause an active stream (retains state)')
    .action(async (streamId) => {
      const spinner = ora(`Pausing stream ${streamId}`).start();
      try {
        const { pauseStream } = await import('../../streaming/index.js');
        await pauseStream(streamId);
        spinner.succeed(`Stream paused: ${streamId}`);
        console.log(chalk.gray('  Resume with: xactions stream resume ' + streamId));
      } catch (error) {
        spinner.fail('Failed to pause stream');
        console.error(chalk.red(error.message));
      }
    });

  streamCmd
    .command('resume <streamId>')
    .description('Resume a paused stream')
    .action(async (streamId) => {
      const spinner = ora(`Resuming stream ${streamId}`).start();
      try {
        const { resumeStream } = await import('../../streaming/index.js');
        await resumeStream(streamId);
        spinner.succeed(`Stream resumed: ${streamId}`);
      } catch (error) {
        spinner.fail('Failed to resume stream');
        console.error(chalk.red(error.message));
      }
    });

  streamCmd
    .command('status <streamId>')
    .description('Get detailed status of a stream')
    .action(async (streamId) => {
      try {
        const { getStreamStatus } = await import('../../streaming/index.js');
        const s = await getStreamStatus(streamId);
        if (!s) {
          console.log(chalk.red(`\n  Stream not found: ${streamId}\n`));
          return;
        }
        const statusColor = s.status === 'running' ? chalk.green : s.status === 'paused' ? chalk.yellow : chalk.red;
        console.log(chalk.bold.cyan(`\n📡 Stream ${s.id}\n`));
        console.log(`  Type:      ${s.type}`);
        console.log(`  Username:  @${s.username}`);
        console.log(`  Status:    ${statusColor(s.status)}`);
        console.log(`  Interval:  ${s.interval / 1000}s`);
        console.log(`  Polls:     ${s.pollCount}`);
        console.log(`  Events:    ${s.eventCount || 0}`);
        console.log(`  Errors:    ${s.errorCount}`);
        if (s.lastPollAt) console.log(`  Last poll: ${chalk.gray(s.lastPollAt)}`);
        if (s.createdAt) console.log(`  Created:   ${chalk.gray(s.createdAt)}`);
        console.log('');
      } catch (error) {
        console.error(chalk.red('Failed to get status: ' + error.message));
      }
    });

  streamCmd
    .command('stop-all')
    .description('Stop all active streams')
    .action(async () => {
      const spinner = ora('Stopping all streams').start();
      try {
        const { stopAllStreams } = await import('../../streaming/index.js');
        const result = await stopAllStreams();
        spinner.succeed(`All streams stopped (${result.stopped || 0} streams)`);
      } catch (error) {
        spinner.fail('Failed to stop all streams');
        console.error(chalk.red(error.message));
      }
    });
}
