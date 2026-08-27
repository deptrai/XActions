// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions daemon` lifecycle command.
 *
 * Start, status, and stop the persistent MCP HTTP/SSE daemon on port 3001.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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

      // Atomic PID file write: write to .tmp then rename to avoid corruption.
      await fs.mkdir(configDir, { recursive: true });
      const tmpFile = DAEMON_FILE + '.tmp';
      await fs.writeFile(tmpFile, JSON.stringify(daemonState, null, 2));
      await fs.rename(tmpFile, DAEMON_FILE);

      // Wait for /health to respond.
      const ready = await waitForHealth(port, 10000);
      if (!ready) {
        // Kill the orphaned daemon process to prevent port leak.
        try { proc.kill('SIGKILL'); } catch {}
        await fs.unlink(DAEMON_FILE).catch(() => {});
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

      const pid = /** @type {number} */ (state.pid);

      const alive = isProcessAlive(pid);
      if (!alive) {
        console.log(chalk.yellow(`⚠️  Daemon PID ${pid} is not running.`));
        await fs.unlink(DAEMON_FILE).catch(() => {});
        return;
      }

      // Verify the PID actually belongs to our daemon before killing.
      const command = getProcessCommand(pid);
      if (!command.includes('src/mcp/server.js') && !command.includes('mcp/server.js')) {
        console.log(chalk.yellow(`⚠️  PID ${pid} is not an XActions daemon. Cleaning up stale state.`));
        await fs.unlink(DAEMON_FILE).catch(() => {});
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        console.error(chalk.red(`❌ Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
        return;
      }

      // Wait briefly for the process to disappear.
      const stopped = await waitForProcessExit(pid, 5000);
      if (stopped) {
        console.log(chalk.green(`✅ Daemon stopped (PID ${pid})`));
        await fs.unlink(DAEMON_FILE).catch(() => {});
      } else {
        console.error(chalk.red(`❌ Daemon did not stop within 5s (PID ${pid})`));
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
 * Check whether a process with the given PID is alive.
 * Handles EPERM (process exists but owned by another user) as alive.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it.
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM') return true;
    return false;
  }
}

/**
 * Return the command line for a running process in a cross-platform way.
 *
 * - macOS: `ps -p <pid> -o command=`
 * - Linux: read `/proc/<pid>/cmdline`
 * - Windows: `wmic process where "ProcessId=<pid>" get CommandLine`
 *
 * Returns an empty string if the command line cannot be determined.
 *
 * @param {number} pid
 * @returns {string}
 */
function getProcessCommand(pid) {
  if (process.platform === 'win32') {
    try {
      return execFileSync(
        'wmic',
        ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'],
        { encoding: 'utf-8', timeout: 3000 }
      );
    } catch {
      return '';
    }
  }

  if (process.platform === 'darwin') {
    try {
      return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf-8',
        timeout: 3000,
      });
    } catch {
      return '';
    }
  }

  // Linux and most other Unix-like systems.
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return raw.replace(/\0/g, ' ');
  } catch {
    return '';
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
export { getDaemonStatus, waitForHealth, isProcessAlive, getProcessCommand, waitForProcessExit };
