// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { displayTerminalQrCode, isTty, renderTerminalQr } from '../../src/utils/qrcode.js';

describe('Story 12.1 — QR Code Utility (src/utils/qrcode.js)', () => {
  const originalStdout = { ...process.stdout };
  const originalIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
    process.stdout.columns = originalColumns;
    vi.restoreAllMocks();
  });

  describe('displayTerminalQrCode(data, options)', () => {
    it.skip('[P0] should render ASCII QR matrix on TTY terminal with 1:1 ratio blocks', async () => {
      process.stdout.isTTY = true;
      process.stdout.columns = 120;

      const output = await displayTerminalQrCode('https://x.com/i/flow/qr?token=test12345');
      expect(output).toBeDefined();
      expect(typeof output).toBe('string');
      // Should contain unicode block characters used in ASCII QR rendering
      expect(output).toMatch(/[\u2588\u2580\u2584\s]/);
    });

    it.skip('[P0] should automatically use small matrix when terminal width is narrow (< 80 columns)', async () => {
      process.stdout.isTTY = true;
      process.stdout.columns = 60;

      const output = await displayTerminalQrCode('https://x.com/i/flow/qr?token=test12345');
      expect(output).toBeDefined();
      expect(typeof output).toBe('string');
      // Verify line width does not exceed terminal columns
      const lines = output.split('\n');
      for (const line of lines) {
        // Strip ANSI codes if any
        const plainLine = line.replace(/\u001b\[\d+m/g, '');
        expect(plainLine.length).toBeLessThanOrEqual(60);
      }
    });

    it.skip('[P0] should render plain URL and short code on Non-TTY environments without terminal escapes', async () => {
      process.stdout.isTTY = false;
      delete process.stdout.columns;

      const output = await displayTerminalQrCode('https://x.com/i/flow/qr?token=test12345', {
        shortCode: 'XACT-99'
      });

      expect(output).toBeDefined();
      expect(output).toContain('https://x.com/i/flow/qr?token=test12345');
      expect(output).toContain('XACT-99');
      // Must not contain cursor manipulation ANSI escape sequences
      expect(output).not.toContain('\x1b[');
    });

    it.skip('[P1] should include plain text URL below QR when options.showUrl is true', async () => {
      process.stdout.isTTY = true;
      process.stdout.columns = 100;

      const testUrl = 'https://x.com/i/flow/qr?token=url_test';
      const output = await displayTerminalQrCode(testUrl, { showUrl: true });

      expect(output).toContain(testUrl);
    });

    it.skip('[P1] should throw PlatformError or formatted error if data is empty or invalid', async () => {
      await expect(displayTerminalQrCode('')).rejects.toThrow(/invalid|empty/i);
    });

    it.skip('[P2] should preserve backward compatibility with renderTerminalQr(text, options)', async () => {
      const output = await renderTerminalQr('https://xactions.app');
      expect(output).toBeDefined();
      expect(typeof output).toBe('string');
    });
  });

  describe('isTty() helper', () => {
    it.skip('[P0] should accurately reflect process.stdout.isTTY state', () => {
      process.stdout.isTTY = true;
      expect(isTty()).toBe(true);

      process.stdout.isTTY = false;
      expect(isTty()).toBe(false);
    });
  });
});
