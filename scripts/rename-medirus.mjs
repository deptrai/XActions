#!/usr/bin/env node
// Rename XActions -> medirus across repo content. by nichxbt
// Usage: node scripts/rename-medirus.mjs [--apply] [--root <dir>]
// Default: dry-run — prints match counts per rule and files touched.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const APPLY = process.argv.includes('--apply');
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx > -1 ? process.argv[rootIdx + 1] : process.cwd();

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-cloudflare', 'coverage', '.next', '.turbo']);
const SKIP_FILES = new Set(['rename-medirus.mjs']);

// Ordered: most-specific first. See docs/rename-to-medirus-plan.md.
// (?<!github.com/<user>/) guards keep repo URLs intact until the GitHub repo itself is renamed.
const GH = /(?<!(?:github\.com|raw\.githubusercontent\.com|[a-z0-9-]+\.github\.io)\/[A-Za-z0-9_-]+\/)/;
const RULES = [
  ['api.xactions.app',  /api\.xactions\.app/g,                  'api.medirus.online'],
  ['api.xactions.io',   /api\.xactions\.io/g,                   'api.medirus.online'],
  ['xactions.app',      /xactions\.app/g,                       'medirus.online'],
  ['xactions.io',       /xactions\.io/g,                        'medirus.online'],
  ['x-actions',         /x-actions/g,                           'medirus-'],
  ['x_actions',         /x_actions/g,                           'medirus'],
  ['X_ACTIONS',         /X_ACTIONS/g,                           'MEDIRUS'],
  ['XACTIONS',          /XACTIONS/g,                            'MEDIRUS'],
  ['XActions',          new RegExp(GH.source + /(?<![A-Za-z0-9])XActions/.source, 'g'), 'Medirus'],
  ['xActions',          new RegExp(GH.source + /(?<![A-Za-z])xActions/.source, 'g'),    'medirus'],
  ['xactions',          new RegExp(GH.source + /(?<![A-Za-z0-9])xactions/.source, 'g'), 'medirus'],
];

function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const stats = Object.fromEntries(RULES.map(r => [r[0], 0]));
const filesChanged = [];
let scanned = 0, skippedBinary = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue;

    const buf = readFileSync(p);
    if (buf.length > 5 * 1024 * 1024 || isBinary(buf)) { skippedBinary++; continue; }
    scanned++;
    let text = buf.toString('utf8');
    let out = text;
    for (const [name, re, rep] of RULES) {
      out = out.replace(re, () => { stats[name]++; return rep; });
    }
    if (out !== text) {
      filesChanged.push(relative(ROOT, p));
      if (APPLY) writeFileSync(p, out);
    }
  }
}

walk(ROOT);

console.log(`mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}  scanned: ${scanned}  binary-skipped: ${skippedBinary}`);
for (const [name, n] of Object.entries(stats)) console.log(`  ${name.padEnd(18)} ${n}`);
console.log(`files changed: ${filesChanged.length}`);
if (!APPLY) filesChanged.slice(0, 40).forEach(f => console.log(`  ${f}`));
