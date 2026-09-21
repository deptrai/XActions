#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). MIT License.
// XActions — Jev verification harness + CI regression guard
// Đo Jev trên corpus tweet thật: Việt/slang/mixed/English + spam detection.
// Chạy: TYPESAFE_API_KEY=... node scripts/jev-verify/verify.mjs [--mock] [--ci] [--validate] [--out <path>]
//
// --mock         không gọi API, in request shape để kiểm format (không đọc floors; --out bị bỏ qua).
// --ci           strict gate: accuracy floors + baseline drift + error-rate → exit 1 khi breach.
// --validate     offline check: corpus schema + floors/baseline config, không gọi API → exit 0/1.
// --out <path>   ghi metrics JSON ra file TRƯỚC khi exit (kể cả khi floor breach / failure).
// Env: TYPESAFE_API_KEY (required), TYPESAFE_API_ENDPOINT (override), GITHUB_SHA (audit).
// by nichxbt

import { readFileSync, writeFileSync, realpathSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const MIN_CORPUS_ITEMS = 50;
const FETCH_TIMEOUT_MS = 30000;
const VALID_LANGS = new Set(['vi', 'en', 'mixed']);

const apiEndpoint = () => process.env.TYPESAFE_API_ENDPOINT || DEFAULT_ENDPOINT;

// GitHub workflow commands: %, CR and LF can split/inject annotations — strip them
const sanitize = (s) => String(s).replace(/[\r\n]+/g, ' ').replace(/%/g, '');
const annotate = (kind, msg) => console.log(`::${kind}::${sanitize(msg)}`);

// ── Question set (isSpam instruction phải byte-identical với 3 prod sites ────
//    thoughtLeaderAgent ×2 + algorithmBuilder — shared spam-detection contract)
/**
 * Build the Jev question set evaluated against every corpus item.
 * @param {string[]} _keywords niche keywords (reserved — state carries them, not the questions)
 * @returns {object} questions map for POST /v1/systemone
 */
export function buildQuestions(_keywords) {
  return {
    relevance: {
      type: 'score',
      instructions: 'How relevant is this post to the niche topics? Rate against the levels.',
      criteria: ['irrelevant or off-topic', 'marginal / tangential', 'clearly relevant', 'core topic'],
    },
    action: {
      type: 'choice',
      instructions: 'Best action for an account in this niche to take on this post?',
      criteria: {
        ignore: 'Do nothing — not worth engaging',
        like: 'Like only',
        bookmark: 'Save for later reference',
        reply: 'Worth a thoughtful reply',
        quote: 'Worth quote-tweeting with commentary',
      },
    },
    isSpam: {
      type: 'noul',
      instructions: 'This post is spam, bait, scam, or airdrop-farming — not mere self-promotion',
    },
    replyWorthy: {
      type: 'noul',
      instructions: 'A genuine, value-adding reply is likely to be well received here',
    },
  };
}

async function callJev(item, questions, nicheKeywords, apiKey, mock) {
  const state = { tweet: item.text, author: item.author, nicheKeywords };
  const body = { state, model: MODEL, questions };

  if (mock) {
    return { _mock: true, requestBody: body };
  }
  const res = await fetch(apiEndpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Jev ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Score one corpus item against Jev answers. Missing/partial answers yield
 * null predictions instead of throwing (item simply misses its truth).
 * @param {object} item corpus item {id, lang, text, author, truth}
 * @param {object} [answers] Jev `answers` object (may be undefined/partial)
 * @returns {object} per-item evaluation {id, lang, pred, truth, hit}
 */
export function evaluate(item, answers) {
  const a = answers ?? {};
  // map score levels to numeric relevance (0-3 → 0-100)
  const relScore = a.relevance?.score ?? null;
  const relConf = a.relevance?.confidence ?? null;
  const action = a.action?.choice ?? null;
  const actConf = a.action?.confidence ?? null;
  const spam = a.isSpam?.noul ?? null;         // 0..1
  const replyW = a.replyWorthy?.noul ?? null;

  const predRelevant = relScore !== null && relScore >= 2; // >= 'clearly relevant'
  const predSpam = spam !== null && spam >= 0.6;

  return {
    id: item.id, lang: item.lang, text: item.text.slice(0, 60),
    relScore, relConf, action, actConf, spam, replyW,
    pred: { relevant: +predRelevant, spam: +predSpam },
    truth: item.truth,
    hit: { relevant: +predRelevant === item.truth.relevant, spam: +predSpam === item.truth.spam },
  };
}

/**
 * Aggregate per-item evaluations into run metrics.
 * byLang = combined accuracy per lang (relevant && spam both hit).
 * @param {object[]} results evaluate() outputs
 * @param {{tokens?: {in: number, out: number}, wallMs?: number}} [extra]
 * @returns {object} {evaluated, relevance, spam, byLang, tokens, wallMs, cost}
 */
export function summarize(results, extra = {}) {
  const tokens = extra.tokens ?? { in: 0, out: 0 };
  const n = results.length;
  const relevance = n ? results.filter(r => r.hit.relevant).length / n : 0;
  const spam = n ? results.filter(r => r.hit.spam).length / n : 0;
  const buckets = {};
  for (const r of results) { (buckets[r.lang] ||= []).push(r.hit.relevant && r.hit.spam ? 1 : 0); }
  const byLang = {};
  for (const [l, arr] of Object.entries(buckets)) {
    byLang[l] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  const cost = (tokens.in / 1e9) * 42; // $42/B input tokens per TypeSafe
  return { evaluated: n, relevance, spam, byLang, tokens, wallMs: extra.wallMs ?? 0, cost };
}

// baseline flat keys → summary paths: relevance/spam → top-level, others → byLang
const metricValue = (summary, key) =>
  key === 'relevance' ? summary.relevance : key === 'spam' ? summary.spam : summary.byLang?.[key];

/**
 * Gate check for --ci mode. Pure function — no I/O, vitest-friendly.
 * @param {object} summary summarize() output
 * @param {object} cfg {floors, baseline, errors, totalItems}
 *   floors:   {overall:{relevance,spam,...}, byLang:{...}, driftWarnDelta, maxItemErrorRate, minItems?}
 *   baseline: {relevance, spam, vi, mixed, en, ...} flat keys
 *   errors:   per-item API error count; totalItems: corpus.items.length
 * @returns {{ok: boolean, breaches: object[], warnings: object[], errorRate: number}}
 */
export function checkFloors(summary, cfg = {}) {
  const floors = cfg.floors ?? {};
  const baseline = cfg.baseline ?? {};
  const errors = cfg.errors ?? 0;
  const totalItems = cfg.totalItems ?? summary.evaluated ?? 0;
  const minItems = floors.minItems ?? MIN_CORPUS_ITEMS;
  const maxErrRate = floors.maxItemErrorRate ?? 0.2;
  const driftDelta = floors.driftWarnDelta ?? 0.05;
  const EPS = 1e-9;
  const pct = (v) => `${((v ?? 0) * 100).toFixed(1)}%`;

  const breaches = [];
  const warnings = [];

  // Corpus floor — the gate is meaningless on a thin sample
  if (totalItems < minItems) {
    breaches.push({
      metric: 'corpus', actual: totalItems, floor: minItems,
      message: `corpus below minimum (${totalItems} < ${minItems})`,
    });
  }

  // Item error rate — API outage makes the run invalid; never floor a thin sample
  const errorRate = totalItems > 0 ? errors / totalItems : (errors > 0 ? 1 : 0);
  if (errorRate > maxErrRate + EPS) {
    breaches.push({
      metric: 'errorRate', actual: errorRate, floor: maxErrRate,
      message: `item error rate ${pct(errorRate)} > max ${pct(maxErrRate)} — run invalid`,
    });
    return { ok: false, breaches, warnings, errorRate };
  }

  // Hard floors: every metric named in floors.overall + floors.byLang
  for (const [key, floor] of Object.entries(floors.overall ?? {})) {
    if (typeof floor !== 'number') continue;
    const actual = summary[key];
    if (actual == null || actual < floor - EPS) {
      breaches.push({
        metric: key, actual, floor,
        message: `${key} accuracy ${pct(actual)} < floor ${pct(floor)}`,
      });
    }
  }
  for (const [lang, floor] of Object.entries(floors.byLang ?? {})) {
    if (typeof floor !== 'number') continue;
    const actual = summary.byLang?.[lang];
    if (actual == null || actual < floor - EPS) {
      breaches.push({
        metric: lang, actual, floor,
        message: `${lang} accuracy ${pct(actual)} < floor ${pct(floor)}`,
      });
    }
  }

  // Soft drift warnings — every metric present in baseline, only when it still
  // clears its floor (below-floor metrics already reported as breaches).
  const floorFor = (key) => floors.overall?.[key] ?? floors.byLang?.[key];
  for (const [key, base] of Object.entries(baseline)) {
    if (typeof base !== 'number') continue;
    const current = metricValue(summary, key);
    if (current == null) {
      warnings.push({
        metric: key, baseline: base,
        message: `baseline metric ${key} absent from summary — drift check skipped`,
      });
      continue;
    }
    const floor = floorFor(key);
    if (floor != null && current < floor - EPS) continue;
    const delta = base - current;
    if (delta >= driftDelta - EPS) {
      warnings.push({
        metric: key, actual: current, baseline: base, delta,
        message: `${key} drifted -${(delta * 100).toFixed(1)}đ vs baseline`,
      });
    }
  }

  return { ok: breaches.length === 0, breaches, warnings, errorRate };
}

// ── gate config (floors.json + baseline.json) ────────────────────────────────
const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

function validateFloors(floors) {
  if (!floors || typeof floors !== 'object' || Array.isArray(floors)) {
    throw new Error('floors.json must be an object');
  }
  if (!floors.overall || typeof floors.overall !== 'object' || Array.isArray(floors.overall)) {
    throw new Error('floors.overall must be an object of metrics');
  }
  for (const [k, v] of Object.entries(floors.overall)) {
    if (!isUnit(v)) throw new Error(`floors.overall.${k} must be numeric in 0..1`);
  }
  if (!isUnit(floors.overall.relevance) || !isUnit(floors.overall.spam)) {
    throw new Error('floors.overall.relevance and floors.overall.spam are required (numeric 0..1)');
  }
  if (floors.byLang != null) {
    if (typeof floors.byLang !== 'object' || Array.isArray(floors.byLang)) {
      throw new Error('floors.byLang must be an object of metrics');
    }
    for (const [k, v] of Object.entries(floors.byLang)) {
      if (!isUnit(v)) throw new Error(`floors.byLang.${k} must be numeric in 0..1`);
    }
  }
  if (!isUnit(floors.byLang?.vi)) {
    throw new Error('floors.byLang.vi is required (numeric 0..1)');
  }
  if (!isUnit(floors.driftWarnDelta)) throw new Error('floors.driftWarnDelta must be numeric in 0..1');
  if (!isUnit(floors.maxItemErrorRate)) throw new Error('floors.maxItemErrorRate must be numeric in 0..1');
  if (floors.minItems !== undefined && (!Number.isInteger(floors.minItems) || floors.minItems < 1)) {
    throw new Error('floors.minItems must be a positive integer when present');
  }
}

function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new Error('baseline.json must be an object of numeric metrics');
  }
  if (!isUnit(baseline.relevance) || !isUnit(baseline.spam)) {
    throw new Error('baseline.relevance and baseline.spam are required (numeric 0..1)');
  }
  for (const [k, v] of Object.entries(baseline)) {
    if (k.startsWith('_')) continue; // metadata keys (_note)
    if (!isUnit(v)) throw new Error(`baseline.${k} must be numeric in 0..1`);
  }
}

function loadGateConfig() {
  const out = { floors: null, baseline: null, error: null };
  try {
    const floors = JSON.parse(readFileSync(join(__dirname, 'floors.json'), 'utf-8'));
    validateFloors(floors);
    out.floors = floors;
  } catch (e) {
    out.error = `floors.json: ${e.message}`;
    return out;
  }
  try {
    const baseline = JSON.parse(readFileSync(join(__dirname, 'baseline.json'), 'utf-8'));
    validateBaseline(baseline);
    out.baseline = baseline;
  } catch (e) {
    out.error = `baseline.json: ${e.message}`;
    return out;
  }
  return out;
}

// ── corpus item schema — bad items burn paid API calls + corrupt metrics ─────
/**
 * Validate corpus items pre-API.
 * @param {object[]} items
 * @returns {{valid: object[], bad: {id: string, problems: string[]}[]}}
 */
export function validateCorpusItems(items) {
  const seen = new Set();
  const valid = [];
  const bad = [];
  for (const item of Array.isArray(items) ? items : []) {
    const problems = [];
    const id = item?.id;
    if (typeof id !== 'string' || !id) problems.push('missing/non-string id');
    else if (seen.has(id)) problems.push('duplicate id');
    if (typeof item?.text !== 'string' || !item.text.trim()) problems.push('missing/empty text');
    if (!VALID_LANGS.has(item?.lang)) problems.push(`invalid lang '${item?.lang}'`);
    const t = item?.truth ?? {};
    if (t.relevant !== 0 && t.relevant !== 1) problems.push('truth.relevant not 0|1');
    if (t.spam !== 0 && t.spam !== 1) problems.push('truth.spam not 0|1');
    if (problems.length) bad.push({ id: typeof id === 'string' ? id : '?', problems });
    else { seen.add(id); valid.push(item); }
  }
  return { valid, bad };
}

// ── flags ────────────────────────────────────────────────────────────────────
const KNOWN_FLAGS = new Set(['--mock', '--ci', '--validate']);

function parseFlags(argv) {
  const out = { mock: false, ci: false, validate: false, outPath: null, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (KNOWN_FLAGS.has(a)) {
      if (a === '--mock') out.mock = true;
      else if (a === '--ci') out.ci = true;
      else out.validate = true;
    } else if (a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        out.error = '--out requires a file path value';
        return out;
      }
      out.outPath = v;
      i++;
    } else if (a.startsWith('--out=')) {
      const v = a.slice('--out='.length);
      if (!v) {
        out.error = '--out requires a non-empty file path';
        return out;
      }
      out.outPath = v;
    } else {
      out.error = `unknown argument: ${a}`;
      return out;
    }
  }
  return out;
}

// ── --out helpers — artifact must exist on every failure path ────────────────
const baseAudit = () => ({
  date: new Date().toISOString(),
  model: MODEL,
  endpoint: apiEndpoint(),
  commit: process.env.GITHUB_SHA ?? null,
});

const minimalOut = (extra = {}) => ({ ...baseAudit(), errors: 0, errorItems: [], ...extra });

function writeOut(outPath, payload) {
  if (!outPath) return;
  try {
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`📝 results written → ${outPath}`);
  } catch (e) {
    console.log(`⚠️ could not write ${outPath}: ${e.message}`);
  }
}

function loadCorpus() {
  const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));
  if (!corpus || typeof corpus !== 'object' || !Array.isArray(corpus.items)) {
    throw new Error('corpus.json missing items array');
  }
  return corpus;
}

// ── --validate: offline gate — runs even without TYPESAFE_API_KEY ────────────
function runValidate() {
  let ok = true;
  console.log('🧪 Jev verify — --validate (offline checks, no API calls)');

  let corpus = null;
  try {
    corpus = loadCorpus();
    console.log(`✅ corpus.json parses — ${corpus.items.length} items`);
  } catch (e) {
    ok = false;
    annotate('error', `corpus.json — ${e.message}`);
    console.log(`❌ corpus.json — ${e.message}`);
  }
  if (corpus) {
    const { bad } = validateCorpusItems(corpus.items);
    if (bad.length) {
      ok = false;
      for (const b of bad) {
        annotate('error', `corpus item ${b.id}: ${b.problems.join('; ')}`);
        console.log(`❌ item ${b.id}: ${b.problems.join('; ')}`);
      }
    } else {
      console.log('✅ all corpus items valid (id/lang/text/truth)');
    }
  }

  const gate = loadGateConfig();
  if (gate.error) {
    ok = false;
    annotate('error', `gate config — ${gate.error}`);
    console.log(`❌ gate config — ${gate.error}`);
  } else {
    console.log('✅ floors.json + baseline.json valid');
  }
  return ok ? 0 : 1;
}

// ── main — returns an exit code (entry block assigns process.exitCode) ───────
/**
 * @param {string[]} [argv] CLI args (defaults to process.argv.slice(2))
 * @returns {Promise<number>} exit code 0|1
 */
export async function main(argv = process.argv.slice(2)) {
  const flags = parseFlags(argv);
  if (flags.error) {
    if (argv.includes('--ci')) annotate('error', flags.error);
    console.error(`❌ ${flags.error}`);
    return 1;
  }
  const { mock, ci, validate, outPath } = flags;

  // --validate: offline schema/config check — no API, no key required
  if (validate) {
    return runValidate();
  }

  const fail = (msg, extra = {}) => {
    if (ci) annotate('error', msg);
    console.error(`❌ ${msg}`);
    writeOut(outPath, minimalOut({ error: msg, ...extra }));
    return 1;
  };

  let corpus;
  try {
    corpus = loadCorpus();
  } catch (e) {
    return fail(`corpus.json unreadable — ${e.message}`);
  }
  const apiKey = process.env.TYPESAFE_API_KEY;

  console.log(`🧪 Jev verify — ${corpus.items.length} items ${mock ? '(MOCK — no API call)' : ''}${ci ? ' [CI gate]' : ''}`);

  // --mock: preview request shape only — never reads floors/baseline
  if (mock) {
    if (outPath) console.log('⚠️ --out ignored under --mock');
    const questions = buildQuestions(corpus.nicheKeywords);
    for (const item of corpus.items) {
      const res = await callJev(item, questions, corpus.nicheKeywords, apiKey, true);
      console.log(`\n[MOCK request for ${item.id}]`);
      console.log(JSON.stringify(res.requestBody, null, 2).slice(0, 1400));
    }
    return 0;
  }

  // Gate config — broken gate must fail loud in CI, warn-and-continue locally
  const gate = loadGateConfig();
  if (gate.error) {
    if (ci) return fail(`gate config invalid — ${gate.error}`);
    console.log(`⚠️ gate config skipped — ${gate.error}`);
  }

  // Corpus item schema — bad items burn paid API calls + corrupt metrics
  const { valid: validItems, bad: badItems } = validateCorpusItems(corpus.items);
  if (badItems.length) {
    if (ci) {
      for (const b of badItems) annotate('error', `corpus item ${b.id} invalid: ${b.problems.join('; ')}`);
      return fail(`corpus has ${badItems.length} invalid item(s)`, {
        errors: badItems.length, errorItems: badItems,
      });
    }
    for (const b of badItems) console.log(`⚠️ skipping invalid item ${b.id}: ${b.problems.join('; ')}`);
  }
  const items = ci ? corpus.items : validItems;

  // Corpus minimum — same floors.minItems ?? default that checkFloors honors,
  // checked BEFORE paying for API calls
  const minItems = gate.floors?.minItems ?? MIN_CORPUS_ITEMS;
  if (ci && corpus.items.length < minItems) {
    return fail(`corpus below minimum (${corpus.items.length} < ${minItems})`);
  }

  if (!apiKey) {
    return fail('TYPESAFE_API_KEY not set. Run with --mock to preview request shape.');
  }

  const questions = buildQuestions(corpus.nicheKeywords);
  const results = [];
  const errorItems = [];
  let errors = 0;
  const totTokens = { in: 0, out: 0 };
  const t0 = Date.now();

  for (const item of items) {
    try {
      const res = await callJev(item, questions, corpus.nicheKeywords, apiKey, false);
      if (!res || typeof res.answers !== 'object' || res.answers === null || Array.isArray(res.answers)) {
        throw new Error('response missing answers object');
      }
      const ev = evaluate(item, res.answers);
      results.push(ev);
      totTokens.in += res.usage?.input_tokens || 0;
      totTokens.out += res.usage?.output_tokens || 0;
      console.log(`${ev.hit.relevant && ev.hit.spam ? '✅' : '⚠️ '} ${ev.id} [${ev.lang}] rel=${ev.relScore}(c${ev.relConf?.toFixed(2)}) act=${ev.action}(c${ev.actConf?.toFixed(2)}) spam=${ev.spam?.toFixed(2)} reply=${ev.replyW?.toFixed(2)}`);
    } catch (e) {
      errors++;
      errorItems.push({ id: item.id, lang: item.lang, error: e.message });
      if (ci) annotate('warning', `${item.id} API error — ${e.message}`);
      console.log(`❌ ${item.id}: ${e.message}`);
    }
  }

  if (!results.length) {
    if (ci) {
      return fail('no items evaluated — run invalid', { errors, errorItems });
    }
    return 0; // legacy behavior: nothing to summarize, exit 0
  }

  const summary = summarize(results, { tokens: totTokens, wallMs: Date.now() - t0 });

  console.log('\n════════ RESULT ════════');
  console.log(`Relevance accuracy : ${(summary.relevance * 100).toFixed(0)}%`);
  console.log(`Spam accuracy      : ${(summary.spam * 100).toFixed(0)}%`);
  for (const [l, acc] of Object.entries(summary.byLang)) {
    const count = results.filter(r => r.lang === l).length;
    console.log(`  ${l}: ${(acc * 100).toFixed(0)}% (${count})`);
  }
  console.log(`Tokens in/out      : ${summary.tokens.in}/${summary.tokens.out}`);
  console.log(`Wall time          : ${(summary.wallMs / 1000).toFixed(1)}s for ${summary.evaluated} calls`);
  console.log(`Est. input cost    : $${summary.cost.toFixed(6)}`);
  if (errors) console.log(`Item errors        : ${errors}/${corpus.items.length}`);

  // ── CI gate: floors + drift + error-rate ───────────────────────────────────
  let verdict = null;
  if (ci) {
    verdict = checkFloors(summary, {
      floors: gate.floors,
      baseline: gate.baseline,
      errors,
      totalItems: corpus.items.length,
    });
    for (const b of verdict.breaches) annotate('error', b.message);
    for (const w of verdict.warnings) annotate('warning', w.message);
    console.log(verdict.ok ? '✅ floors pass' : '❌ floors breached');
  }

  // ── --out: ghi results JSON TRƯỚC khi exit (kể cả floor breach) ────────────
  if (outPath) {
    writeOut(outPath, {
      ...baseAudit(),
      metrics: { relevance: summary.relevance, spam: summary.spam },
      byLang: summary.byLang,
      tokens: summary.tokens,
      cost: summary.cost,
      evaluated: summary.evaluated,
      totalItems: corpus.items.length,
      errors,
      errorRate: errors / Math.max(corpus.items.length, 1),
      gate: verdict ? { ok: verdict.ok, breaches: verdict.breaches, warnings: verdict.warnings } : null,
      perItem: [...results, ...errorItems],
    });
  }

  return verdict && !verdict.ok ? 1 : 0;
}

let invokedAsEntry = false;
try {
  invokedAsEntry = !!process.argv[1] &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch {
  invokedAsEntry = false; // argv[1] not resolvable — not our entry point
}
if (invokedAsEntry) {
  try {
    process.exitCode = await main();
  } catch (e) {
    // No unhandled crash — every failure path ends in a deliberate exit code
    const msg = `verify crashed — ${e.message}`;
    if (process.argv.includes('--ci')) annotate('error', msg);
    console.error(`❌ ${msg}`);
    const f = parseFlags(process.argv.slice(2));
    if (!f.error && f.outPath) {
      writeOut(f.outPath, minimalOut({ error: msg }));
    }
    process.exitCode = 1;
  }
}
