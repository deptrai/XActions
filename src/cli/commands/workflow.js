// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions workflow` — manage and run automation workflows.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import fs from 'fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { loadConfig } from '../shared.js';

/**
 * Register the workflow command group.
 *
 * @param {import('commander').Command} program
 */
export function registerWorkflowCommand(program) {
  const workflowCmd = program
    .command('workflow')
    .description('Manage and run automation workflows');

  workflowCmd
    .command('create')
    .description('Create a workflow from a JSON file or interactively')
    .option('-f, --file <path>', 'Path to workflow JSON file')
    .action(async (options) => {
      try {
        const workflows = (await import('../../workflows/index.js')).default;

        if (options.file) {
          const content = await fs.readFile(options.file, 'utf-8');
          const definition = JSON.parse(content);
          const workflow = await workflows.create(definition);
          console.log(chalk.green(`✓ Workflow created: ${workflow.name} (${workflow.id})`));
          return;
        }

        const answers = await inquirer.prompt([
          { type: 'input', name: 'name', message: 'Workflow name:' },
          { type: 'input', name: 'description', message: 'Description (optional):' },
          {
            type: 'list',
            name: 'triggerType',
            message: 'Trigger type:',
            choices: ['manual', 'schedule', 'webhook'],
          },
          {
            type: 'input',
            name: 'cron',
            message: 'Cron expression (e.g., */30 * * * *):',
            when: (a) => a.triggerType === 'schedule',
          },
        ]);

        const trigger = { type: answers.triggerType };
        if (answers.cron) trigger.cron = answers.cron;

        const workflow = await workflows.create({
          name: answers.name,
          description: answers.description,
          trigger,
          steps: [],
        });

        console.log(chalk.green(`✓ Workflow created: ${workflow.name} (${workflow.id})`));
        console.log(chalk.gray('  Add steps by editing the workflow JSON or using the API.'));
      } catch (error) {
        console.error(chalk.red('Failed to create workflow: ' + error.message));
      }
    });

  workflowCmd
    .command('run <name>')
    .description('Run a workflow by name or ID')
    .option('--auth <token>', 'X/Twitter session cookie for authentication')
    .action(async (name, options) => {
      const spinner = ora(`Running workflow "${name}"`).start();
      try {
        const workflows = (await import('../../workflows/index.js')).default;
        const config = await loadConfig();

        const result = await workflows.run(name, {
          trigger: 'cli',
          authToken: options.auth || config.authToken,
          onProgress: (event) => {
            if (event.type === 'step_start') {
              spinner.text = `Step ${event.step + 1}/${event.total}: ${event.name}`;
            } else if (event.type === 'step_error') {
              spinner.warn(`Step error: ${event.error}`);
            } else if (event.type === 'condition_failed') {
              spinner.info(`Condition not met at step ${event.step}: ${event.details}`);
            }
          },
        });

        if (result.status === 'completed') {
          spinner.succeed(`Workflow "${result.workflowName}" completed (${result.stepsCompleted}/${result.totalSteps} steps)`);
        } else if (result.status === 'failed') {
          spinner.fail(`Workflow failed: ${result.error}`);
        } else {
          spinner.info(`Workflow finished with status: ${result.status}`);
        }

        if (result.steps) {
          console.log(chalk.bold('\nStep Results:'));
          for (const step of result.steps) {
            const icon = step.status === 'completed' ? chalk.green('✓') : step.status === 'skipped' ? chalk.yellow('○') : chalk.red('✗');
            console.log(`  ${icon} ${step.name} — ${step.status}`);
            if (step.error) console.log(chalk.red(`    Error: ${step.error}`));
          }
        }
      } catch (error) {
        spinner.fail('Failed to run workflow');
        console.error(chalk.red(error.message));
      }
    });

  workflowCmd
    .command('list')
    .description('List all workflows')
    .action(async () => {
      try {
        const workflows = (await import('../../workflows/index.js')).default;
        const list = await workflows.list();

        if (list.length === 0) {
          console.log(chalk.gray('\n  No workflows found.'));
          console.log(chalk.gray('  Create one with: xactions workflow create -f workflow.json\n'));
          return;
        }

        console.log(chalk.bold.cyan('\n⚡ Workflows\n'));
        for (const wf of list) {
          const status = wf.enabled ? chalk.green('● enabled') : chalk.gray('○ disabled');
          const trigger = wf.trigger?.type || 'manual';
          console.log(`  ${status}  ${chalk.bold(wf.name)} ${chalk.gray(`(${wf.id?.slice(0, 8)}...)`)}`);
          console.log(`         Trigger: ${trigger}  Steps: ${wf.stepsCount}`);
          if (wf.description) console.log(`         ${chalk.gray(wf.description)}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Failed to list workflows: ' + error.message));
      }
    });

  workflowCmd
    .command('delete <id>')
    .description('Delete a workflow')
    .action(async (id) => {
      try {
        const workflows = (await import('../../workflows/index.js')).default;
        const deleted = await workflows.remove(id);
        if (deleted) {
          console.log(chalk.green(`✓ Workflow deleted: ${id}`));
        } else {
          console.log(chalk.red(`Workflow not found: ${id}`));
        }
      } catch (error) {
        console.error(chalk.red('Failed to delete workflow: ' + error.message));
      }
    });

  workflowCmd
    .command('actions')
    .description('List available workflow actions')
    .action(async () => {
      try {
        const workflows = (await import('../../workflows/index.js')).default;
        const actions = workflows.listActions();

        console.log(chalk.bold.cyan('\n⚡ Available Workflow Actions\n'));

        const categories = {};
        for (const action of actions) {
          const cat = action.category || 'general';
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(action);
        }

        for (const [cat, acts] of Object.entries(categories)) {
          console.log(chalk.bold(`  ${cat.toUpperCase()}`));
          for (const a of acts) {
            console.log(`    ${chalk.cyan(a.name)} — ${a.description}`);
          }
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Failed to list actions: ' + error.message));
      }
    });

  workflowCmd
    .command('runs <workflowId>')
    .description('Show execution history for a workflow')
    .option('-l, --limit <number>', 'Max runs to show', '10')
    .action(async (workflowId, options) => {
      try {
        const workflows = (await import('../../workflows/index.js')).default;
        const runsList = await workflows.runs(workflowId, parseInt(options.limit, 10));

        if (runsList.length === 0) {
          console.log(chalk.gray('\n  No runs found for this workflow.\n'));
          return;
        }

        console.log(chalk.bold.cyan('\n📊 Execution History\n'));
        for (const r of runsList) {
          const statusIcon = r.status === 'completed' ? chalk.green('✓') : r.status === 'failed' ? chalk.red('✗') : chalk.yellow('●');
          const time = r.startedAt ? new Date(r.startedAt).toLocaleString() : 'N/A';
          console.log(`  ${statusIcon} ${chalk.gray(r.id?.slice(0, 8))}  ${r.status}  ${r.stepsCompleted}/${r.totalSteps} steps  ${chalk.gray(time)}`);
          if (r.error) console.log(chalk.red(`    Error: ${r.error}`));
        }
        console.log('');
      } catch (error) {
        console.error(chalk.red('Failed to get runs: ' + error.message));
      }
    });
}
