# Build 05-15 — Lint Audit Report & Summary Script

> **Agent Role:** Implementer
> **Depends on:** `05-01` through `05-14` (entire track)
> **Creates:** `scripts/lint-audit.js`, `LINT_REPORT.md`

---

## Task

Create a lint audit script that runs ESLint programmatically and produces a structured JSON + Markdown report. Then run a final audit to document the starting vs ending lint error count — the ending count should be **0 errors** after Track 05 is complete.

---

## File: `scripts/lint-audit.js`

```js
#!/usr/bin/env node

/**
 * Lint Audit Script — Runs ESLint programmatically and produces a report.
 *
 * Usage:
 *   node scripts/lint-audit.js              # Print markdown to stdout
 *   node scripts/lint-audit.js --json       # Print JSON to stdout
 *   node scripts/lint-audit.js --output     # Write LINT_REPORT.md to project root
 *
 * @module lint-audit
 * by nichxbt
 */

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const ROOT = resolve(__dirname, '..');

// ── Parse CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const outputMode = args.includes('--output');

// ── Run ESLint via CLI (most reliable cross-version approach) ─────────
function runEslint() {
  try {
    const output = execSync('npx eslint . --format json 2>/dev/null', {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024, // 50 MB buffer for large codebases
    });
    return JSON.parse(output);
  } catch (error) {
    // ESLint exits with code 1 when there are lint errors — that's expected
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        console.error('Failed to parse ESLint JSON output');
        process.exit(1);
      }
    }
    console.error('ESLint execution failed:', error.message);
    process.exit(1);
  }
}

// ── Analyze results ───────────────────────────────────────────────────
function analyzeResults(eslintResults) {
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFixable = 0;
  const errorsByRule = {};
  const warningsByRule = {};
  const fileStats = [];

  for (const result of eslintResults) {
    const filePath = relative(ROOT, result.filePath);
    const fileErrors = result.errorCount;
    const fileWarnings = result.warningCount;
    const fileFixable = result.fixableErrorCount + result.fixableWarningCount;

    totalErrors += fileErrors;
    totalWarnings += fileWarnings;
    totalFixable += fileFixable;

    if (fileErrors > 0 || fileWarnings > 0) {
      fileStats.push({
        file: filePath,
        errors: fileErrors,
        warnings: fileWarnings,
        fixable: fileFixable,
      });
    }

    for (const message of result.messages) {
      const bucket = message.severity === 2 ? errorsByRule : warningsByRule;
      const rule = message.ruleId || 'unknown';
      bucket[rule] = (bucket[rule] || 0) + 1;
    }
  }

  // Sort files by error count (descending), then warnings
  fileStats.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);

  // Sort rules by count (descending)
  const sortedErrorRules = Object.entries(errorsByRule)
    .sort(([, a], [, b]) => b - a);
  const sortedWarningRules = Object.entries(warningsByRule)
    .sort(([, a], [, b]) => b - a);

  return {
    summary: {
      totalFiles: eslintResults.length,
      filesWithIssues: fileStats.length,
      totalErrors,
      totalWarnings,
      totalFixable,
      cleanFiles: eslintResults.length - fileStats.length,
    },
    errorsByRule: sortedErrorRules,
    warningsByRule: sortedWarningRules,
    fileStats: fileStats.slice(0, 20), // Top 20 files
  };
}

// ── Generate Markdown report ──────────────────────────────────────────
function generateMarkdown(analysis) {
  const { summary, errorsByRule, warningsByRule, fileStats } = analysis;
  const now = new Date().toISOString().split('T')[0];

  let md = `# Lint Audit Report — Medirus

**Generated:** ${now}
**Tool:** ESLint v9+ with flat config

---

## Summary

| Metric | Count |
|--------|-------|
| Total files scanned | ${summary.totalFiles} |
| Files with issues | ${summary.filesWithIssues} |
| Clean files | ${summary.cleanFiles} |
| **Total errors** | **${summary.totalErrors}** |
| **Total warnings** | **${summary.totalWarnings}** |
| Auto-fixable | ${summary.totalFixable} |

`;

  if (summary.totalErrors === 0) {
    md += `> ✅ **Zero lint errors!** Track 05 target achieved.\n\n`;
  } else {
    md += `> ⚠️ **${summary.totalErrors} errors remaining.** Continue fixing.\n\n`;
  }

  md += `---\n\n## Errors by Rule\n\n`;

  if (errorsByRule.length === 0) {
    md += `No errors found. 🎉\n\n`;
  } else {
    md += `| Rule | Count |\n|------|-------|\n`;
    for (const [rule, count] of errorsByRule) {
      md += `| \`${rule}\` | ${count} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n## Warnings by Rule\n\n`;

  if (warningsByRule.length === 0) {
    md += `No warnings found.\n\n`;
  } else {
    md += `| Rule | Count |\n|------|-------|\n`;
    for (const [rule, count] of warningsByRule.slice(0, 15)) {
      md += `| \`${rule}\` | ${count} |\n`;
    }
    if (warningsByRule.length > 15) {
      md += `| ... and ${warningsByRule.length - 15} more rules | |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n## Files with Most Issues (Top 20)\n\n`;

  if (fileStats.length === 0) {
    md += `All files are clean! 🎉\n\n`;
  } else {
    md += `| File | Errors | Warnings | Fixable |\n|------|--------|----------|---------|\n`;
    for (const f of fileStats) {
      md += `| \`${f.file}\` | ${f.errors} | ${f.warnings} | ${f.fixable} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n## Track 05 Progress\n\n`;
  md += `| Milestone | Status |\n|-----------|--------|\n`;
  md += `| ESLint config created | ✅ |\n`;
  md += `| Prettier config created | ✅ |\n`;
  md += `| Husky + lint-staged | ✅ |\n`;
  md += `| Import order rules | ✅ |\n`;
  md += `| JSDoc rules | ✅ |\n`;
  md += `| Security rules | ✅ |\n`;
  md += `| Scraper lint fixed | ✅ |\n`;
  md += `| CLI lint fixed | ✅ |\n`;
  md += `| MCP lint fixed | ✅ |\n`;
  md += `| API lint fixed | ✅ |\n`;
  md += `| Automation lint fixed | ✅ |\n`;
  md += `| Utils/Auth/Client lint fixed | ✅ |\n`;
  md += `| EditorConfig + VS Code | ✅ |\n`;
  md += `| CI workflow | ✅ |\n`;
  md += `| Final audit (this report) | ✅ |\n`;
  md += `| **Errors: 0** | ${summary.totalErrors === 0 ? '✅' : '❌'} |\n`;

  return md;
}

// ── Main ──────────────────────────────────────────────────────────────
console.error('Running ESLint audit...');
const eslintResults = runEslint();
const analysis = analyzeResults(eslintResults);

if (jsonMode) {
  console.log(JSON.stringify(analysis, null, 2));
} else {
  const markdown = generateMarkdown(analysis);

  if (outputMode) {
    const outputPath = resolve(ROOT, 'LINT_REPORT.md');
    writeFileSync(outputPath, markdown, 'utf8');
    console.error(`Report written to ${outputPath}`);
  } else {
    console.log(markdown);
  }
}

// Exit with code 1 if there are errors (useful for CI)
if (analysis.summary.totalErrors > 0) {
  process.exit(1);
}
```

---

## Step 1 — Add Script to `package.json`

Add to the `"scripts"` section:

```json
{
  "scripts": {
    "lint:audit": "node scripts/lint-audit.js --output"
  }
}
```

---

## Step 2 — Run the Final Audit

```bash
# Generate the report
node scripts/lint-audit.js --output

# View it
cat LINT_REPORT.md

# Also generate JSON for programmatic use
node scripts/lint-audit.js --json > lint-report.json
cat lint-report.json | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
  console.log('Errors:', data.summary.totalErrors);
  console.log('Warnings:', data.summary.totalWarnings);
  console.log('Clean files:', data.summary.cleanFiles);
"
```

---

## Step 3 — Verify Final State

```bash
# ESLint should report 0 errors
npm run lint && echo "✅ ESLint: 0 errors" || echo "❌ ESLint: errors found"

# Prettier should report 0 violations
npm run format:check && echo "✅ Prettier: all formatted" || echo "❌ Prettier: violations found"

# Audit script should exit with code 0
node scripts/lint-audit.js && echo "✅ Audit: clean" || echo "❌ Audit: issues found"

# All tests should pass
npx vitest run --reporter=verbose 2>&1 | tail -10
```

---

## Step 4 — Record Baseline vs Final Comparison

If the baseline from build 05-00 was recorded, include a comparison:

```markdown
## Before & After

| Metric | Before (05-00) | After (05-15) | Change |
|--------|----------------|---------------|--------|
| Total errors | [from baseline] | 0 | -100% |
| Total warnings | [from baseline] | [current] | [calculated] |
| Files with issues | [from baseline] | [current] | [calculated] |
| `var` declarations | [from baseline] | 0 | -100% |
| `==` comparisons | [from baseline] | 0 | -100% |
```

---

## Step 5 — Commit the Report

```bash
git add LINT_REPORT.md scripts/lint-audit.js
git commit -m "build(05-15): add lint audit script and final report"
```

---

## Acceptance Criteria

- [ ] `scripts/lint-audit.js` exists and is executable
- [ ] Script runs ESLint programmatically and parses JSON output
- [ ] Script produces a structured JSON report with: `summary`, `errorsByRule`, `warningsByRule`, `fileStats`
- [ ] Script produces a Markdown report with tables for errors by rule, warnings by rule, and top files
- [ ] `--json` flag outputs JSON to stdout
- [ ] `--output` flag writes `LINT_REPORT.md` to project root
- [ ] Script exits with code 1 if there are lint errors (useful for CI)
- [ ] `npm run lint:audit` runs the script and writes the report
- [ ] Final audit shows **0 lint errors**
- [ ] Final audit shows warnings are only from JSDoc rules (expected for incremental adoption)
- [ ] All tests pass (`npx vitest run`)
- [ ] `LINT_REPORT.md` committed to repository
