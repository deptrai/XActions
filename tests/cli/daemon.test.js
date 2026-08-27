// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CLI daemon helper tests (Story 14.2)
 *
 * Exercises the file logic behind `xactions daemon` without spawning a real
 * MCP server. Uses real HTTP and child processes only — no mocks.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  getDaemonStatus,
  waitForHealth,
  isProcessAlive,
  waitForProcessExit,
} from '../../src/cli/commands/daemon.js';

let server;
let serverPort;

function startHealthServer() {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', transport: 'http', tools: 1, sessions: 0 }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind to a port'));
        return;
      }
      server = s;
      serverPort = addr.port;
      resolve(s);
    });
  });
}

function closeHealthServer() {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.closeAllConnections?.();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

afterEach(async () => {
  await closeHealthServer();
});

describe('getDaemonStatus', () => {
  it('returns running:true when a daemon responds on /health', async () => {
    await startHealthServer();
    const status = await getDaemonStatus(serverPort);

    assert.equal(status.running, true);
    assert.ok(status.health);
    assert.equal(status.health.status, 'ok');
    assert.equal(status.health.transport, 'http');
  });

  it('returns running:false when nothing responds on the port', async () => {
    const status = await getDaemonStatus(1);
    assert.equal(status.running, false);
    assert.equal(status.health, undefined);
  });
});

describe('waitForHealth', () => {
  it('resolves true once /health is available', async () => {
    // Start the server slightly after the polling begins to exercise the loop.
    const portPromise = new Promise((resolve) => {
      setTimeout(async () => {
        await startHealthServer();
        resolve(serverPort);
      }, 150);
    });

    const port = await portPromise;
    const ready = await waitForHealth(port, 5000);
    assert.equal(ready, true);
  });

  it('resolves false when /health never responds', async () => {
    const ready = await waitForHealth(1, 500);
    assert.equal(ready, false);
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('returns false for a non-existent PID', () => {
    assert.equal(isProcessAlive(999999999), false);
  });
});

describe('waitForProcessExit', () => {
  it('returns true after a child process exits', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 100)'], {
      stdio: 'ignore',
    });

    await new Promise((resolve) => child.on('close', resolve));

    const stopped = await waitForProcessExit(child.pid, 5000);
    assert.equal(stopped, true);
    assert.equal(isProcessAlive(child.pid), false);
  });
});
