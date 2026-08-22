#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions CLI
 * Command-line interface for X/Twitter automation
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license MIT
 */

import { Command, Help } from 'commander';
import { VERSION } from '../version.js';
import chalk from 'chalk';
import { registerConnectCommand } from './commands/connect.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerReportCommand } from './commands/report.js';
import { registerQuickstartCommand } from './commands/quickstart.js';
import { registerCompletionCommand } from './commands/completion.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerScrapeCommand } from './commands/scrape.js';
import { registerAutomateCommand } from './commands/automate.js';
import { registerReadCommands } from './commands/read.js';
import { registerPluginCommand } from './commands/plugin.js';
import { registerStreamCommand } from './commands/stream.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerGraphCommand } from './commands/graph.js';
import { registerPortabilityCommands } from './commands/portability.js';
import { registerMcpConfigCommand } from './commands/mcp-config.js';
import { registerInfoCommands } from './commands/info.js';

import { registerAnalyticsCommands } from './commands/analytics.js';
import { registerAiCommands } from './commands/ai.js';
import { registerPersonaCommands } from './commands/persona.js';
import { registerHistoryCommands } from './commands/history.js';
import { registerAudienceCommand } from './commands/audience.js';
import { registerCrmCommand } from './commands/crm.js';
import { registerBulkCommand } from './commands/bulk.js';
import { registerScheduleCommand } from './commands/schedule.js';
import { registerEvergreenCommand } from './commands/evergreen.js';
import { registerRssCommand } from './commands/rss.js';
import { registerOptimizerCommands } from './commands/optimizer.js';
import { registerNotifyCommand } from './commands/notify.js';
import { registerDatasetCommand } from './commands/dataset.js';
import { registerCheckpointsCommand } from './commands/checkpoints.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerTeamCommand } from './commands/team.js';
import { registerCompatCommands } from './commands/compat.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerClientCommand } from './commands/client.js';
import { renderRootHelp } from './help-groups.js';

const program = new Command();

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name('xactions')
  .description(chalk.bold('⚡ XActions - The Complete X/Twitter Automation Toolkit'))
  .version(VERSION);

// ============================================================================
// Commands that live in their own modules
//
// index.js is long enough that adding to it makes it harder to read, so
// anything new is registered from src/cli/commands/. Each module owns its
// flags, its rendering and its error handling, and takes whatever it needs
// from here as an explicit dependency rather than reaching back in.
// ============================================================================

registerConnectCommand(program);
registerDoctorCommand(program);
registerReportCommand(program);
registerQuickstartCommand(program, { version: VERSION });
registerCompletionCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);
registerScrapeCommand(program);
registerAutomateCommand(program);
registerReadCommands(program);
registerPluginCommand(program);
registerStreamCommand(program);
registerWorkflowCommand(program);
registerGraphCommand(program);
registerPortabilityCommands(program);
registerMcpConfigCommand(program);
registerInfoCommands(program);

registerAnalyticsCommands(program);
registerAiCommands(program);
registerPersonaCommands(program);
registerHistoryCommands(program);
registerAudienceCommand(program);
registerCrmCommand(program);
registerBulkCommand(program);
registerScheduleCommand(program);
registerEvergreenCommand(program);
registerRssCommand(program);
registerOptimizerCommands(program);
registerNotifyCommand(program);
registerDatasetCommand(program);
registerCheckpointsCommand(program);
registerSchemaCommand(program);
registerTeamCommand(program);
registerCompatCommands(program);
registerAgentCommand(program);
registerClientCommand(program);

// ============================================================================
// Parse and Run
// ============================================================================

// Fifty-plus commands printed as one flat alphabetical list tells a newcomer
// nothing about where to start. Replace Commander's root help with the grouped
// screen; sub-command help keeps the default format, which is fine at that size.
const defaultFormatHelp = Help.prototype.formatHelp;
program.configureHelp({
  formatHelp(command, helper) {
    return command === program
      ? renderRootHelp(program, VERSION)
      : defaultFormatHelp.call(this, command, helper);
  },
});

// Commander prints help and exits when it is given no arguments, so bare
// `xactions` lands on the grouped screen above. That screen points at
// `xactions quickstart` in three places, which is where a first-time user
// should go; there is deliberately no redirect here, because an implicit jump
// would hide the command list from someone who ran the binary to see it.
program.parse();
