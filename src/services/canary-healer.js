// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CanaryHealer — GitOps-Driven DOM Drift Healing Orchestrator (Story 39.2).
 * Coordinates: load drift status → AutoSelectorFallback.investigate →
 * SelectorSandbox validation → unified-diff generation → GitHub Draft PR
 * (or `.patch` file / GitHub Issue fallback). Manual trigger only; never
 * mutates `canary-targets.json` directly — always produces a reviewable patch.
 *
 * Invariant #4: no runtime hot-patching — output is always a Draft PR or a
 * .patch file, never an in-place edit.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AutoSelectorFallback } from '../core/auto-selector-fallback.js';
import { SelectorSandbox } from './selector-sandbox.js';
import { generateJsonUnifiedDiff } from '../utils/unified-diff.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config/canary-targets.json');
const CONFIG_REPO_PATH = 'config/canary-targets.json';

/**
 * Check whether `gh` CLI is available on PATH.
 * @param {(cmd: string, args: string[]) => Promise<any>} [execFn]
 * @returns {Promise<boolean>}
 */
async function isGhCliAvailable(execFn = execFileAsync) {
  try {
    await execFn('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export class CanaryHealer {
  /** @type {string} */
  #configPath;

  /** @type {AutoSelectorFallback} */
  #fallback;

  /** @type {SelectorSandbox} */
  #sandbox;

  /** @type {(cmd: string, args: string[]) => Promise<any>} */
  #exec;

  /** @type {typeof console.log} */
  #log;

  /**
   * @param {object} [options]
   * @param {string} [options.configPath]
   * @param {AutoSelectorFallback} [options.autoSelectorFallback]
   * @param {SelectorSandbox} [options.selectorSandbox]
   * @param {(cmd: string, args: string[]) => Promise<any>} [options.execFn] injected for tests
   * @param {(...args: any[]) => void} [options.log]
   */
  constructor(options = {}) {
    this.#configPath = options.configPath || DEFAULT_CONFIG_PATH;
    this.#fallback = options.autoSelectorFallback || new AutoSelectorFallback(options.fallbackOptions || {});
    this.#sandbox = options.selectorSandbox || new SelectorSandbox(options.sandboxOptions || {});
    this.#exec = options.execFn || execFileAsync;
    this.#log = options.log || ((...args) => console.log(...args));
  }

  /**
   * Load `canary-targets.json` config from disk.
   * @returns {Record<string, Array<object>>}
   */
  #loadConfig() {
    const raw = fs.readFileSync(this.#configPath, 'utf8');
    return JSON.parse(raw);
  }

  /**
   * Resolve a target entry from the config.
   * @param {string} platform
   * @param {string} targetName
   * @returns {{ target: object | null, platformTargets: Array<object> | null }}
   */
  #resolveTarget(platform, targetName) {
    const config = this.#loadConfig();
    const platformTargets = config[platform];
    if (!Array.isArray(platformTargets)) {
      return { target: null, platformTargets: null };
    }
    const target = platformTargets.find((t) => t && t.name === targetName) || null;
    return { target, platformTargets };
  }

  /**
   * Apply a patched selectorChain into a deep-cloned config object.
   * @param {object} config
   * @param {string} platform
   * @param {string} targetName
   * @param {string[]} newChain
   * @returns {object} Patched config (new object)
   */
  #applyPatch(config, platform, targetName, newChain) {
    const next = JSON.parse(JSON.stringify(config));
    const arr = next[platform] || [];
    const idx = arr.findIndex((t) => t && t.name === targetName);
    if (idx === -1) return next;
    arr[idx] = { ...arr[idx], selectorChain: newChain };
    return next;
  }

  /**
   * Run `gh` CLI and return stdout.
   * @param {string[]} args
   */
  async #gh(args) {
    const { stdout } = await this.#exec('gh', args);
    return stdout;
  }

  /**
   * Write a `.patch` file alongside instructions for manual application.
   * @param {string} patch
   * @param {string} outputPath
   * @param {object} meta
   * @returns {string} Absolute path written
   */
  #writePatchFile(patch, outputPath, meta) {
    const absPath = path.resolve(outputPath);
    const header = [
      `# XActions Canary Healer patch`,
      `# platform: ${meta.platform}`,
      `# target: ${meta.target}`,
      `# url: ${meta.url}`,
      `# generated: ${new Date().toISOString()}`,
      `#`,
      `# Apply manually:`,
      `#   git apply ${path.basename(absPath)}`,
      `#   git checkout -b canary-heal/${meta.platform}-${meta.target}`,
      `#   git add ${CONFIG_REPO_PATH}`,
      `#   git commit -m "fix(canary): heal ${meta.platform}/${meta.target} selector drift"`,
      `#   gh pr create --draft --title "fix(canary): heal ${meta.platform}/${meta.target}" --body "Auto-generated by xactions canary heal"`,
      ``,
    ].join('\n');
    fs.writeFileSync(absPath, header + patch, 'utf8');
    return absPath;
  }

  /**
   * Create a GitHub Draft PR containing the patch.
   * @param {object} ctx
   * @returns {Promise<string>} PR URL
   */
  async #createDraftPr(ctx) {
    const branch = `canary-heal/${ctx.platform}-${ctx.target}-${Date.now()}`;
    const title = `fix(canary): heal ${ctx.platform}/${ctx.target} selector drift`;
    const bodyLines = [
      `Automated selector drift healing generated by \`xactions canary heal\`.`,
      ``,
      `- **Platform:** ${ctx.platform}`,
      `- **Target:** ${ctx.target}`,
      `- **URL:** ${ctx.url}`,
      `- **Old chain:** ${ctx.oldChain.map((s) => `\`${s}\``).join(' → ')}`,
      `- **New chain:** ${ctx.newChain.map((s) => `\`${s}\``).join(' → ')}`,
      ``,
      `### Validated candidates`,
      ...(ctx.validatedCandidates.length
        ? ctx.validatedCandidates.map((c) => `- \`${c.selector}\` (score: ${c.confidenceScore ?? 'n/a'})`).join('\n').split('\n')
        : ['- none']),
      ``,
      `_Draft PR — human review required before merge._`,
    ];
    const body = bodyLines.join('\n');

    // Write patched config to a temp worktree via git checkout
    await this.#exec('git', ['checkout', '-b', branch]);
    try {
      fs.writeFileSync(this.#configPath, JSON.stringify(ctx.patchedConfig, null, 2) + '\n', 'utf8');
      await this.#exec('git', ['add', CONFIG_REPO_PATH]);
      await this.#exec('git', ['commit', '-m', title]);
      await this.#exec('git', ['push', '-u', 'origin', branch]);
      const out = await this.#gh([
        'pr', 'create',
        '--draft',
        '--title', title,
        '--body', body,
        '--base', 'main',
        '--head', branch,
      ]);
      return String(out || '').trim();
    } finally {
      // Return to previous branch — best-effort
      try { await this.#exec('git', ['checkout', '-']); } catch { /* ignore */ }
    }
  }

  /**
   * File a GitHub Issue when no valid replacement selectors are found.
   * @param {object} ctx
   * @returns {Promise<string>} Issue URL or empty string
   */
  async #createInvestigationIssue(ctx) {
    const title = `Selector drift: no valid replacement found for ${ctx.platform}/${ctx.target}`;
    const body = [
      `\`xactions canary heal\` investigated ${ctx.platform}/${ctx.target} at ${ctx.url} but produced no validated candidates.`,
      ``,
      `### Investigation summary`,
      `- Candidates evaluated: ${ctx.candidateCount}`,
      `- Validation failures:`,
      ...(ctx.rejectionReasons.length
        ? ctx.rejectionReasons.map((r) => `  - \`${r.selector}\`: ${r.reason}`)
        : ['  - none']),
      ``,
      `_Manual investigation required._`,
    ].join('\n');
    const out = await this.#gh(['issue', 'create', '--title', title, '--body', body]);
    return String(out || '').trim();
  }

  /**
   * Heal a single platform/target.
   *
   * @param {string} platform
   * @param {string} targetName
   * @param {object} [opts]
   * @param {boolean} [opts.preview]
   * @param {string} [opts.output]
   * @param {boolean} [opts.createIssue=true]
   * @returns {Promise<import('../../types/core.d.ts').HealingResult>}
   */
  async heal(platform, targetName, opts = {}) {
    const { target, platformTargets } = this.#resolveTarget(platform, targetName);
    if (!platformTargets) {
      throw new Error(`Unknown platform or target: ${platform}/${targetName}`);
    }
    if (!target) {
      throw new Error(`Unknown platform or target: ${platform}/${targetName}`);
    }

    const oldChain = Array.isArray(target.selectorChain) ? target.selectorChain : [];
    const expectedShape = target.expectedShape || null;
    if (!expectedShape) {
      throw new Error(`Target ${platform}/${targetName} missing expectedShape — cannot validate candidates`);
    }

    // Step 1 — investigate
    const candidates = await this.#fallback.investigate(platform, target.url, expectedShape, opts.fallbackOpts || {});
    const rejectionReasons = [];
    const validated = [];

    // Step 2 — validate each candidate in sandbox
    for (const c of candidates || []) {
      const sel = c && c.selector;
      if (!sel) continue;
      const res = await this.#sandbox.validate(target.url, sel, expectedShape, opts.sandboxOpts || {});
      if (res.valid) {
        validated.push({ ...c, extractedSample: res.extractedSample });
      } else {
        rejectionReasons.push({ selector: sel, reason: res.error || 'unknown' });
      }
    }

    const baseResult = {
      platform,
      target: targetName,
      url: target.url,
      oldChain,
      candidateCount: (candidates || []).length,
      validatedCandidates: validated,
      rejectionReasons,
    };

    if (validated.length === 0) {
      // File issue (if gh available and not preview)
      let issueUrl = null;
      if (!opts.preview && opts.createIssue !== false) {
        try {
          if (await isGhCliAvailable(this.#exec)) {
            issueUrl = await this.#createInvestigationIssue({ ...baseResult });
          }
        } catch (err) {
          this.#log(`⚠️ gh issue create failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return {
        ...baseResult,
        status: 'no-candidates',
        message: 'No valid replacement selectors found',
        issueUrl,
      };
    }

    // Step 3 — construct patched config
    const config = this.#loadConfig();
    const newChain = [validated[0].selector, ...oldChain.slice(1)];
    const patchedConfig = this.#applyPatch(config, platform, targetName, newChain);
    const patch = generateJsonUnifiedDiff(CONFIG_REPO_PATH, config, patchedConfig);

    if (opts.preview) {
      return {
        ...baseResult,
        status: 'preview',
        newChain,
        patch,
      };
    }

    if (opts.output) {
      const filePath = this.#writePatchFile(patch, opts.output, { platform, target: targetName, url: target.url });
      return {
        ...baseResult,
        status: 'patch-file',
        newChain,
        patch,
        patchFile: filePath,
      };
    }

    // Step 4 — PR via gh, or fallback to patch file
    const ghAvailable = await isGhCliAvailable(this.#exec);
    if (!ghAvailable) {
      const fallbackPath = this.#writePatchFile(
        patch,
        opts.output || `canary-heal-${platform}-${targetName}.patch`,
        { platform, target: targetName, url: target.url },
      );
      return {
        ...baseResult,
        status: 'patch-file',
        message: 'gh CLI not found — wrote patch file',
        newChain,
        patch,
        patchFile: fallbackPath,
      };
    }

    try {
      const prUrl = await this.#createDraftPr({
        platform,
        target: targetName,
        url: target.url,
        oldChain,
        newChain,
        validatedCandidates: validated,
        patchedConfig,
      });
      return {
        ...baseResult,
        status: 'draft-pr',
        newChain,
        patch,
        prUrl,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fallbackPath = this.#writePatchFile(
        patch,
        opts.output || `canary-heal-${platform}-${targetName}.patch`,
        { platform, target: targetName, url: target.url },
      );
      return {
        ...baseResult,
        status: 'patch-file',
        message: `gh pr create failed (${msg}) — wrote patch file`,
        newChain,
        patch,
        patchFile: fallbackPath,
      };
    }
  }
}

export default CanaryHealer;
