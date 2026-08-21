// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions graph` — build and analyze social network graphs.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../shared.js';

/**
 * Register the graph command group.
 *
 * @param {import('commander').Command} program
 */
export function registerGraphCommand(program) {
  const graphCmd = program
    .command('graph')
    .description('Build and analyze social network graphs');

  graphCmd
    .command('build <username>')
    .description('Build a social graph by crawling an account\'s network')
    .option('-d, --depth <number>', 'Crawl depth (1 = direct only, 2 = friends-of-friends)', '2')
    .option('-n, --max-nodes <number>', 'Maximum nodes to crawl', '500')
    .option('--auth <token>', 'X/Twitter session cookie')
    .action(async (username, options) => {
      const spinner = ora(`Building social graph for @${username.replace(/^@/, '')}...`).start();
      try {
        const graph = (await import('../../graph/index.js')).default;
        const config = await loadConfig();

        const result = await graph.build(username, {
          depth: parseInt(options.depth, 10),
          maxNodes: parseInt(options.maxNodes, 10),
          authToken: options.auth || config.authToken,
          onProgress: (event) => {
            if (event.phase === 'crawling') {
              spinner.text = `Crawling @${event.username} (depth ${event.depth}) — ${event.nodesCount} nodes, ${event.edgesCount} edges`;
            }
          },
        });

        spinner.succeed(`Graph built: ${result.nodes?.length || 0} nodes, ${result.edges?.length || 0} edges (ID: ${result.id?.slice(0, 8)}...)`);
        console.log(chalk.gray(`  Saved to ~/.xactions/graphs/${result.id}.json`));
      } catch (error) {
        spinner.fail('Failed to build graph');
        console.error(chalk.red(error.message));
      }
    });

  graphCmd
    .command('analyze <graphId>')
    .description('Run analysis on an existing graph (clusters, influence, bridges)')
    .action(async (graphId) => {
      const spinner = ora('Analyzing graph...').start();
      try {
        const graph = (await import('../../graph/index.js')).default;
        const data = await graph.get(graphId);
        if (!data) {
          spinner.fail(`Graph not found: ${graphId}`);
          return;
        }

        const analysis = graph.analyze(data);
        spinner.succeed('Analysis complete');

        console.log(chalk.bold.cyan('\n📊 Graph Analysis\n'));
        console.log(`  Nodes: ${chalk.bold(analysis.nodesCount)}  Edges: ${chalk.bold(analysis.edgesCount)}`);

        if (analysis.clusters.length > 0) {
          console.log(chalk.bold('\n  Clusters:'));
          for (const c of analysis.clusters.slice(0, 5)) {
            console.log(`    ${chalk.cyan(c.label)} — ${c.size} members: ${c.members.slice(0, 5).join(', ')}${c.size > 5 ? '...' : ''}`);
          }
        }

        if (analysis.influenceRanking.length > 0) {
          console.log(chalk.bold('\n  Top Influencers:'));
          for (const u of analysis.influenceRanking.slice(0, 10)) {
            console.log(`    ${chalk.yellow(u.influenceScore.toFixed(1).padStart(5))}  @${u.username}`);
          }
        }

        if (analysis.bridgeAccounts.length > 0) {
          console.log(chalk.bold('\n  Bridge Accounts:'));
          for (const b of analysis.bridgeAccounts.slice(0, 5)) {
            console.log(`    @${chalk.cyan(b.username)} — betweenness: ${b.betweenness}`);
          }
        }

        if (analysis.orbits) {
          const o = analysis.orbits.summary;
          console.log(chalk.bold('\n  Orbit Analysis:'));
          console.log(`    Inner circle: ${o.innerCircle}  Active: ${o.active}  Outer ring: ${o.outerRing}  Periphery: ${o.periphery}`);
        }

        console.log('');
      } catch (error) {
        spinner.fail('Analysis failed');
        console.error(chalk.red(error.message));
      }
    });

  graphCmd
    .command('recommend <graphId>')
    .description('Get follow/engage/unfollow recommendations from a graph')
    .action(async (graphId) => {
      try {
        const graph = (await import('../../graph/index.js')).default;
        const data = await graph.get(graphId);
        if (!data) {
          console.error(chalk.red(`Graph not found: ${graphId}`));
          return;
        }

        const recs = graph.recommend(data, data.seed);

        console.log(chalk.bold.cyan(`\n💡 Recommendations for @${recs.seed}\n`));

        if (recs.followSuggestions.length > 0) {
          console.log(chalk.bold('  Follow these:'));
          for (const s of recs.followSuggestions.slice(0, 8)) {
            console.log(`    ${chalk.green('+')} @${s.username} — ${s.reason}`);
          }
        }

        if (recs.engageSuggestions.length > 0) {
          console.log(chalk.bold('\n  Engage with:'));
          for (const s of recs.engageSuggestions.slice(0, 8)) {
            console.log(`    ${chalk.yellow('★')} @${s.username} — ${s.reason}`);
          }
        }

        if (recs.competitorWatch.length > 0) {
          console.log(chalk.bold('\n  Watch these:'));
          for (const s of recs.competitorWatch.slice(0, 5)) {
            console.log(`    ${chalk.cyan('◉')} @${s.username} — ${s.reason}`);
          }
        }

        if (recs.safeToUnfollow.length > 0) {
          console.log(chalk.bold('\n  Safe to unfollow:'));
          for (const s of recs.safeToUnfollow.slice(0, 8)) {
            console.log(`    ${chalk.gray('−')} @${s.username} — ${s.reason}`);
          }
        }

        console.log('');
      } catch (error) {
        console.error(chalk.red('Failed to get recommendations: ' + error.message));
      }
    });

  graphCmd
    .command('export <graphId>')
    .description('Export a graph for visualization')
    .option('-f, --format <format>', 'Output format: html, gexf, d3', 'html')
    .option('-o, --output <path>', 'Output file path')
    .action(async (graphId, options) => {
      try {
        const graphMod = (await import('../../graph/index.js')).default;
        const data = await graphMod.get(graphId);
        if (!data) {
          console.error(chalk.red(`Graph not found: ${graphId}`));
          return;
        }

        const format = options.format || 'html';
        const result = graphMod.visualize(data, format);

        const ext = format === 'gexf' || format === 'gephi' ? 'gexf' : format === 'html' ? 'html' : 'json';
        const defaultPath = `graph-${data.seed}-${Date.now()}.${ext}`;
        const outPath = options.output || defaultPath;

        const { default: fsPromises } = await import('fs/promises');
        const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        await fsPromises.writeFile(outPath, content);

        console.log(chalk.green(`✓ Graph exported to ${outPath} (${format})`));
      } catch (error) {
        console.error(chalk.red('Failed to export graph: ' + error.message));
      }
    });

  graphCmd
    .command('list')
    .description('List all saved graphs')
    .action(async () => {
      try {
        const graph = (await import('../../graph/index.js')).default;
        const graphs = await graph.list();

        if (graphs.length === 0) {
          console.log(chalk.gray('\n  No graphs found. Build one with: xactions graph build @username\n'));
          return;
        }

        console.log(chalk.bold.cyan('\n📊 Saved Graphs\n'));
        for (const g of graphs) {
          const status = g.status === 'complete' ? chalk.green('● complete') : g.status === 'crawling' ? chalk.yellow('● crawling') : chalk.gray(`● ${g.status}`);
          console.log(`  ${status}  ${chalk.bold('@' + g.seed)} ${chalk.gray(`(${g.id?.slice(0, 8)}...)`)}`);
          console.log(`         ${g.nodesCount} nodes, ${g.edgesCount} edges  ${chalk.gray(g.createdAt || '')}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Failed to list graphs: ' + error.message));
      }
    });

  graphCmd
    .command('delete <graphId>')
    .description('Delete a saved graph')
    .action(async (graphId) => {
      try {
        const graph = (await import('../../graph/index.js')).default;
        const deleted = await graph.delete(graphId);
        if (deleted) {
          console.log(chalk.green(`✓ Graph deleted: ${graphId}`));
        } else {
          console.log(chalk.red(`Graph not found: ${graphId}`));
        }
      } catch (error) {
        console.error(chalk.red('Failed to delete graph: ' + error.message));
      }
    });
}
