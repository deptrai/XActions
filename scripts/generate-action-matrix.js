#!/usr/bin/env node
/**
 * Generate canonical action/arg matrix from x_actions_list.
 * Usage: npm run docs:matrix
 * Output: docs/canonical-action-matrix.md + docs/canonical-action-matrix.json
 */

import { executeActionListTool } from '../src/scrapers/social/actions-list.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const actions = await executeActionListTool({ detailLevel: 'full' });

// Generate JSON
const matrix = {
  generated: new Date().toISOString(),
  platforms: {},
};

for (const action of actions) {
  const platform = action.platform;
  if (!matrix.platforms[platform]) {
    matrix.platforms[platform] = {
      category: action.category || 'unknown',
      no_crawler: action.no_crawler || false,
      actions: [],
    };
  }
  matrix.platforms[platform].actions.push({
    action: action.action,
    description: action.description,
    requiredArgs: action.requiredArgs || [],
    optionalArgs: action.optionalArgs || [],
    example: action.example || {},
    outputType: action.outputType,
    requiresAuth: action.requiresAuth || false,
    syncCapable: Boolean(action.syncCapable),
    status: action.status || 'stable',
  });
}

// Ensure docs directory exists
mkdirSync(join(process.cwd(), 'docs'), { recursive: true });

// Write JSON
writeFileSync(
  join(process.cwd(), 'docs/canonical-action-matrix.json'),
  JSON.stringify(matrix, null, 2)
);

// Write Markdown
let md = '# Canonical Action/Arg Matrix\n\n';
md += `> Auto-generated ${new Date().toISOString()}. Do not edit manually.\n\n`;
md += '| Platform | Category | Action | Sync | Required Args | Optional Args | Example |\n';
md += '|----------|----------|--------|------|---------------|---------------|---------|\n';

for (const [platform, info] of Object.entries(matrix.platforms)) {
  for (const action of info.actions) {
    md += `| ${platform} | ${info.category} | ${action.action || '—'} | ${action.syncCapable ? '✅' : '—'} | ${(action.requiredArgs || []).join(', ') || '—'} | ${(action.optionalArgs || []).join(', ') || '—'} | \`${JSON.stringify(action.example)}\` |\n`;
  }
}

writeFileSync(join(process.cwd(), 'docs/canonical-action-matrix.md'), md);
console.log(`Generated action matrix: ${Object.keys(matrix.platforms).length} platforms, ${actions.length} actions`);
