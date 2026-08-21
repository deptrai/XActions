// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

describe('Story 12.1 — CLI Login Command with QR & Non-TTY Flags (tests/cli/login.test.js)', () => {
  let program;

  beforeEach(() => {
    program = new Command();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CLI Flag Parsing for login command', () => {
    it.skip('[P0] should parse --qr, --qr-url, --push, --cdp, --platform, and --timeout options', () => {
      let capturedOptions = null;

      program
        .command('login')
        .option('--qr', 'Use QR code login')
        .option('--qr-url <url>', 'Provide pre-generated QR URL')
        .option('--push', 'Send push notification for non-TTY')
        .option('--cdp', 'Use CDP attach instead of QR')
        .option('--platform <platform>', 'Platform to authenticate', 'twitter')
        .option('--timeout <seconds>', 'QR timeout', '120')
        .action((options) => {
          capturedOptions = options;
        });

      program.parse([
        'node',
        'xactions',
        'login',
        '--qr',
        '--qr-url',
        'https://x.com/qr/123',
        '--platform',
        'facebook',
        '--timeout',
        '60',
        '--push'
      ]);

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.qr).toBe(true);
      expect(capturedOptions.qrUrl).toBe('https://x.com/qr/123');
      expect(capturedOptions.platform).toBe('facebook');
      expect(capturedOptions.timeout).toBe('60');
      expect(capturedOptions.push).toBe(true);
    });

    it.skip('[P1] should default platform to twitter and timeout to 120s when flags are omitted', () => {
      let capturedOptions = null;

      program
        .command('login')
        .option('--qr', 'Use QR code login')
        .option('--platform <platform>', 'Platform to authenticate', 'twitter')
        .option('--timeout <seconds>', 'QR timeout', '120')
        .action((options) => {
          capturedOptions = options;
        });

      program.parse(['node', 'xactions', 'login', '--qr']);

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.platform).toBe('twitter');
      expect(capturedOptions.timeout).toBe('120');
    });
  });
});
