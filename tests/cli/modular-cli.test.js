// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for modularized CLI command registrations (Story 30.1, Story 31.1, Story 32.1).
 *
 * Verifies that the extracted command modules (syndication, governor, scraping)
 * register expected commands on the Commander program and that all flags/options
 * are correctly attached and accessible.
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { program } from '../../src/cli/index.js';
import { registerSyndicationCommands } from '../../src/cli/commands/syndication.js';
import { registerGovernorCommands } from '../../src/cli/commands/governor.js';
import { registerScrapingCommands } from '../../src/cli/commands/scraping.js';

describe('Modular CLI Command Registrations', () => {
  describe('Main program exports and presence of modular commands', () => {
    it('verifies required modular commands are present on program.commands', () => {
      const commandNames = program.commands.map((cmd) => cmd.name());

      // Task required verification
      expect(commandNames).toContain('publish-all');
      expect(commandNames).toContain('like-all');
      expect(commandNames).toContain('follow-all');
      expect(commandNames).toContain('download-media');
      expect(commandNames).toContain('governor-status');
      expect(commandNames).toContain('panic-stop');

      // Additional modular commands
      expect(commandNames).toContain('panic-resume');
      expect(commandNames).toContain('priorities');
      expect(commandNames).toContain('actions-list');
      expect(commandNames).toContain('scrape');
    });

    it('verifies syndication command options on main program', () => {
      const publishCmd = program.commands.find((c) => c.name() === 'publish-all');
      expect(publishCmd).toBeDefined();
      const publishOptions = publishCmd.options.map((o) => o.long);
      expect(publishOptions).toContain('--text');
      expect(publishOptions).toContain('--platforms');
      expect(publishOptions).toContain('--media');
      expect(publishOptions).toContain('--no-auto-thread');
      expect(publishOptions).toContain('--dry-run');
      expect(publishOptions).toContain('--json');

      const likeCmd = program.commands.find((c) => c.name() === 'like-all');
      expect(likeCmd).toBeDefined();
      const likeOptions = likeCmd.options.map((o) => o.long);
      expect(likeOptions).toContain('--platforms');
      expect(likeOptions).toContain('--uri');
      expect(likeOptions).toContain('--cid');
      expect(likeOptions).toContain('--dry-run');
      expect(likeOptions).toContain('--json');

      const followCmd = program.commands.find((c) => c.name() === 'follow-all');
      expect(followCmd).toBeDefined();
      const followOptions = followCmd.options.map((o) => o.long);
      expect(followOptions).toContain('--platforms');
      expect(followOptions).toContain('--dry-run');
      expect(followOptions).toContain('--json');

      const downloadMediaCmd = program.commands.find((c) => c.name() === 'download-media');
      expect(downloadMediaCmd).toBeDefined();
      const downloadOptions = downloadMediaCmd.options.map((o) => o.long);
      expect(downloadOptions).toContain('--platform');
      expect(downloadOptions).toContain('--quality');
      expect(downloadOptions).toContain('--output');
      expect(downloadOptions).toContain('--json');
    });

    it('verifies governor command options on main program', () => {
      const statusCmd = program.commands.find((c) => c.name() === 'governor-status');
      expect(statusCmd).toBeDefined();
      const statusOptions = statusCmd.options.map((o) => o.long);
      expect(statusOptions).toContain('--url');
      expect(statusOptions).toContain('--token');
      expect(statusOptions).toContain('--json');

      const panicStopCmd = program.commands.find((c) => c.name() === 'panic-stop');
      expect(panicStopCmd).toBeDefined();
      const stopOptions = panicStopCmd.options.map((o) => o.long);
      expect(stopOptions).toContain('--platform');
      expect(stopOptions).toContain('--duration');
      expect(stopOptions).toContain('--reason');
      expect(stopOptions).toContain('--url');
      expect(stopOptions).toContain('--token');
      expect(stopOptions).toContain('--json');

      const panicResumeCmd = program.commands.find((c) => c.name() === 'panic-resume');
      expect(panicResumeCmd).toBeDefined();
      const resumeOptions = panicResumeCmd.options.map((o) => o.long);
      expect(resumeOptions).toContain('--platform');
      expect(resumeOptions).toContain('--url');
      expect(resumeOptions).toContain('--token');
      expect(resumeOptions).toContain('--json');

      const prioritiesCmd = program.commands.find((c) => c.name() === 'priorities');
      expect(prioritiesCmd).toBeDefined();
      const prioritiesOptions = prioritiesCmd.options.map((o) => o.long);
      expect(prioritiesOptions).toContain('--set');
      expect(prioritiesOptions).toContain('--url');
      expect(prioritiesOptions).toContain('--token');
      expect(prioritiesOptions).toContain('--json');
    });

    it('verifies scraping command options on main program', () => {
      const actionsListCmd = program.commands.find((c) => c.name() === 'actions-list');
      expect(actionsListCmd).toBeDefined();
      const options = actionsListCmd.options.map((o) => o.long);
      expect(options).toContain('--platform');

      const scrapeCmd = program.commands.find((c) => c.name() === 'scrape');
      expect(scrapeCmd).toBeDefined();
    });
  });

  describe('Isolated command registration functions', () => {
    it('registerSyndicationCommands registers all 4 syndication commands', () => {
      const testProgram = new Command();
      registerSyndicationCommands(testProgram);

      const names = testProgram.commands.map((c) => c.name());
      expect(names).toEqual(['publish-all', 'like-all', 'follow-all', 'download-media']);
    });

    it('registerGovernorCommands registers all 4 governor commands', () => {
      const testProgram = new Command();
      registerGovernorCommands(testProgram);

      const names = testProgram.commands.map((c) => c.name());
      expect(names).toEqual(['governor-status', 'panic-stop', 'panic-resume', 'priorities']);
    });

    it('registerScrapingCommands registers scrape, actions-list, and actions', () => {
      const testProgram = new Command();
      registerScrapingCommands(testProgram);

      const names = testProgram.commands.map((c) => c.name());
      expect(names).toContain('scrape');
      expect(names).toContain('actions-list');
      expect(names).toContain('actions');
    });
  });
});
