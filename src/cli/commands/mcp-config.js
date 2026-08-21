// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions mcp-config` — generate MCP server config for popular clients.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Register the mcp-config command.
 *
 * @param {import('commander').Command} program
 */
export function registerMcpConfigCommand(program) {
  program
    .command('mcp-config')
    .description('Generate MCP server config for Claude Desktop, Cursor, Windsurf, etc.')
    .option('-w, --write', 'Write config to Claude Desktop config file')
    .option('-c, --client <client>', 'Target client: claude, cursor, windsurf, vscode (default: claude)')
    .action(async (options) => {
      const client = options.client || 'claude';

      const platform = process.platform;
      const home = os.homedir();

      const configPaths = {
        claude: {
          darwin: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
          win32: path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'),
          linux: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
        },
        cursor: {
          darwin: path.join(home, '.cursor', 'mcp.json'),
          win32: path.join(home, '.cursor', 'mcp.json'),
          linux: path.join(home, '.cursor', 'mcp.json'),
        },
        windsurf: {
          darwin: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
          win32: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
          linux: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        },
        vscode: {
          darwin: path.join('.vscode', 'mcp.json'),
          win32: path.join('.vscode', 'mcp.json'),
          linux: path.join('.vscode', 'mcp.json'),
        },
      };

      const configPath = configPaths[client]?.[platform] || configPaths[client]?.linux;

      const mcpEntry = {
        command: 'npx',
        args: ['-y', 'xactions-mcp'],
        env: {
          XACTIONS_SESSION_COOKIE: 'your_auth_token_here',
        },
      };

      const fullConfig = client === 'vscode'
        ? { mcp: { servers: { xactions: mcpEntry } } }
        : { mcpServers: { xactions: mcpEntry } };

      console.log(chalk.bold.cyan('\n⚡ XActions MCP Configuration\n'));
      console.log(chalk.gray(`Client: ${client}`));
      console.log(chalk.gray(`OS:     ${platform}`));
      if (configPath) {
        console.log(chalk.gray(`Config: ${configPath}`));
      }
      console.log();
      console.log(chalk.bold('Add this to your config file:\n'));
      console.log(chalk.white(JSON.stringify(fullConfig, null, 2)));
      console.log();

      if (options.write && configPath) {
        try {
          let existing = {};
          try {
            const data = await fs.readFile(configPath, 'utf-8');
            existing = JSON.parse(data);
          } catch {
            // File doesn't exist yet, start fresh
          }

          const key = client === 'vscode' ? 'mcp' : 'mcpServers';
          if (client === 'vscode') {
            existing.mcp = existing.mcp || {};
            existing.mcp.servers = existing.mcp.servers || {};
            existing.mcp.servers.xactions = mcpEntry;
          } else {
            existing[key] = existing[key] || {};
            existing[key].xactions = mcpEntry;
          }

          await fs.mkdir(path.dirname(configPath), { recursive: true });
          await fs.writeFile(configPath, JSON.stringify(existing, null, 2));

          console.log(chalk.green(`✅ Config written to ${configPath}`));
          console.log(chalk.yellow('\n⚠️  Remember to:'));
          console.log(chalk.yellow('   1. Replace "your_auth_token_here" with your actual auth_token'));
          console.log(chalk.yellow(`   2. Restart ${client === 'claude' ? 'Claude Desktop' : client} to apply changes`));
        } catch (error) {
          console.error(chalk.red(`Failed to write config: ${error.message}`));
          console.log(chalk.gray('\nCopy the JSON above and paste it manually.'));
        }
      } else if (options.write) {
        console.log(chalk.yellow('Config path not found for this client/OS. Copy the JSON above manually.'));
      } else {
        console.log(chalk.gray('Tip: Use --write to write directly to the config file.'));
        console.log(chalk.gray(`     xactions mcp-config --write --client ${client}`));
      }

      console.log(chalk.gray('\n📖 Full setup guide: https://github.com/nirholas/XActions/blob/main/docs/mcp-setup.md'));
      console.log();
    });
}
