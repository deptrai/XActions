// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions daemon` lifecycle command.
 *
 * Start, status, and stop the persistent MCP HTTP/SSE daemon on port 3001.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { CONFIG_DIR } from '../shared.js';

const configDir = /** @type {string} */ (/** @type {unknown} */ (CONFIG_DIR));
const DAEMON_FILE = path.join(configDir, 'daemon.json');

/**
 * @param {import('commander').Command} program
 */
export function registerDaemonCommand(program) {
  const daemon = program
    .command('daemon')
    .description('Manage the MCP HTTP/SSE daemon');

  daemon
    .command('start')
    .description('Start the MCP daemon in HTTP mode')
    .option('--port <port>', 'Port to listen on', '3001')
    .action(async (options) => {
      const port = Number(options.port) || 3001;
      const status = await getDaemonStatus(port);

      if (status.running) {
        console.log(chalk.yellow(`⚠️  Daemon already running on port ${port}`));
        console.log(chalk.gray(`  → http://localhost:${port}/mcp`));
        console.log(chalk.gray(`  → http://localhost:${port}/health`));
        return;
      }

      const proc = spawn(
        process.execPath,
        [path.resolve('src/mcp/server.js')],
        {
          env: {
            ...process.env,
            MCP_TRANSPORT: 'http',
            PORT: String(port),
          },
          detached: true,
          stdio: 'ignore',
        }
      );

      proc.unref();

      const daemonState = {
        pid: proc.pid,
        port,
        url: `http://localhost:${port}`,
        startedAt: new Date().toISOString(),
      };

      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(DAEMON_FILE, JSON.stringify(daemonState, null, 2));

      // Wait for /health to respond.
      const ready = await waitForHealth(port, 10000);
      if (!ready) {
        console.error(chalk.red(`❌ Daemon did not become ready on port ${port}`));
        process.exitCode = 1;
        return;
      }

      console.log(chalk.green(`✅ MCP daemon started on port ${port}`));
      console.log(chalk.gray(`  → ${daemonState.url}/mcp`));
      console.log(chalk.gray(`  → ${daemonState.url}/health`));
    });

  daemon
    .command('status')
    .description('Check whether the MCP daemon is running')
    .option('--port <port>', 'Port to check', '3001')
    .action(async (options) => {
      const port = Number(options.port) || 3001;
      const status = await getDaemonStatus(port);

      if (status.running) {
        console.log(chalk.green(`✅ Daemon is running on port ${port}`));
        console.log(JSON.stringify(status.health, null, 2));
      } else {
        console.log(chalk.yellow(`⚠️  Daemon is not running on port ${port}`));
        process.exitCode = 1;
      }
    });

  daemon
    .command('stop')
    .description('Stop the running MCP daemon')
    .action(async () => {
      const state = await loadDaemonState();

      if (!state?.pid) {
        console.log(chalk.yellow('⚠️  No daemon PID stored. Run `xactions daemon start` first.'));
        return;
      }

      const alive = isProcessAlive(/** @type {number} */ (state.pid));
      if (!alive) {
        console.log(chalk.yellow(`⚠️  Daemon PID ${state.pid} is not running.`));
        await fs.unlink(DAEMON_FILE).catch(() => {});
        return;
      }

      try {
        process.kill(/** @type {number} */ (state.pid), 'SIGTERM');
      } catch (err) {
        console.error(chalk.red(`❌ Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
        return;
      }

      // Wait briefly for the process to disappear.
      const stopped = await waitForProcessExit(/** @type {number} */ (state.pid), 5000);
      if (stopped) {
        console.log(chalk.green(`✅ Daemon stopped (PID ${state.pid})`));
        await fs.unlink(DAEMON_FILE).catch(() => {});
      } else {
        console.error(chalk.red(`❌ Daemon did not stop within 5s (PID ${state.pid})`));
        process.exitCode = 1;
      }
    });
}

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function loadDaemonState() {
  try {
    const data = await fs.readFile(DAEMON_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * @param {number} port
 * @returns {Promise<{ running: boolean, health?: Record<string, unknown> }>}
 */
async function getDaemonStatus(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false };
    const health = await res.json();
    return { running: true, health };
  } catch {
    return { running: false };
  }
}

/**
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForHealth(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getDaemonStatus(port);
    if (status.running) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {number} pid
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForProcessExit(pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !isProcessAlive(pid);
}

// Exported for unit tests that exercise daemon lifecycle helpers without
// spawning a real server process.
export { getDaemonStatus, waitForHealth, isProcessAlive, waitForProcessExit };
