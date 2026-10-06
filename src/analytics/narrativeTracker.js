// by nichxbt
/**
 * @fileoverview Story 54.5: Narrative Clustering & Rotation Detection Engine
 *
 * Clusters crypto discussions into narrative categories (AI Agents, Memecoins,
 * DeSci, RWAs, L2s, DeFi, Gaming, DePIN, etc.), tracks mindshare trends,
 * detects rotations into new narratives via 3-sigma growth flags, discovers
 * emergent narratives dynamically from recurring bigrams, and maps tokens
 * to their winning narrative.
 *
 * Implements:
 *   - createNarrativeTracker(opts) factory with rich DI seams
 *   - getDefaultNarrativeTracker() / resetDefaultNarrativeTracker() singletons
 *   - Classify-once persistence into narrative_assignments
 *   - JevBrain classifyFn + deterministic keyword fallback (via: 'jev' | 'keyword')
 *   - Emergent cluster discovery (__other__ -> emerging:<top-bigram>)
 *   - 3-sigma growth detection against 7d baseline daily shares
 *   - Token-to-narrative plurality vote mapping for mindshare.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDatabase } from './historyStore.js';
import {
  DEFAULT_WEIGHTS,
  DEFAULT_FOLLOWER_BANDS,
  followerWeight,
  engagementScore,
  computeRowWeight,
} from './mindshare.js';

// ============================================================================
// Constants & Defaults
// ============================================================================

export {
  DEFAULT_WEIGHTS,
  DEFAULT_FOLLOWER_BANDS,
  followerWeight,
  engagementScore,
  computeRowWeight,
};

const DEFAULT_HOURS = 24;
const DEFAULT_MIN_BASELINE_DAYS = 3;
const DEFAULT_EMERGENT_MIN_SHARE = 0.05; // 5%
const DEFAULT_EMERGENT_MIN_POSTS = 10;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_24H_MS = 24 * HOUR_MS;
const WINDOW_7D_MS = 7 * DAY_MS;

// Standard English stopwords for bigram extraction
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot', 'could',
  'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t',
  'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
  'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is',
  'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most',
  'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they',
  'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d',
  'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when',
  'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom',
  'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d',
  'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
  'http', 'https', 't', 'co', 'rt', 'amp', 'just', 'like', 'get', 'got', 'will',
]);

// ============================================================================
// Taxonomy Loader
// ============================================================================

/**
 * Loads default taxonomy JSON from config/narrative-taxonomy.json.
 * @returns {Array<{ id: string, label: string, keywords: string[] }>}
 */
function loadDefaultTaxonomy() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const taxonomyPath = join(__dirname, '../../config/narrative-taxonomy.json');
    const content = readFileSync(taxonomyPath, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.categories) ? parsed.categories : []);
  } catch {
    return [];
  }
}

// ============================================================================
// Keyword Taxonomy Matching (Fallback Classifier)
// ============================================================================

/**
 * Deterministic keyword matching against taxonomy categories.
 * Returns '__other__' if no match found.
 *
 * @param {string} content
 * @param {Array<{ id: string, label: string, keywords: string[] }>} taxonomy
 * @returns {string} narrative_id or '__other__'
 */
export function keywordMatch(content, taxonomy) {
  if (typeof content !== 'string' || !content.trim()) {
    return '__other__';
  }

  const textLower = content.toLowerCase();

  for (const cat of taxonomy) {
    if (!Array.isArray(cat.keywords)) continue;
    for (const kw of cat.keywords) {
      if (!kw || typeof kw !== 'string') continue;
      const kwLower = kw.trim().toLowerCase();
      if (!kwLower) continue;

      if (kwLower.includes(' ')) {
        // Multi-word phrase: substring match
        if (textLower.includes(kwLower)) {
          return cat.id;
        }
      } else {
        // Single word: word boundary regex to avoid partial substring false positives
        const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i');
        if (re.test(textLower)) {
          return cat.id;
        }
      }
    }
  }

  return '__other__';
}

// ============================================================================
// Bigram Extraction & Clustering
// ============================================================================

/**
 * Extract clean word tokens from post text.
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeText(text) {
  if (typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Extract unique bigrams from post content.
 * @param {string} content
 * @returns {string[]}
 */
export function extractBigrams(content) {
  const tokens = tokenizeText(content);
  if (tokens.length < 2) return [];

  const bigrams = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    const b = `${tokens[i]} ${tokens[i + 1]}`;
    if (!seen.has(b)) {
      seen.add(b);
      bigrams.push(b);
    }
  }
  return bigrams;
}

// ============================================================================
// Narrative Tracker Engine Factory
// ============================================================================

/**
 * Factory creating a NarrativeTracker instance.
 *
 * @param {object} [options]
 * @param {any} [options.db]
 * @param {() => { degraded: boolean, consecutiveEmptyBatches?: number, degradedSince?: number }} [options.healthFn]
 * @param {(posts: Array<{ id: string, text: string }>) => Promise<Array<{ id: string, narrativeId: string }>>} [options.classifyFn]
 * @param {() => number} [options.now]
 * @param {object} [options.watchlist]
 * @param {Array<{ id: string, label: string, keywords: string[] }>} [options.taxonomy]
 * @param {number} [options.hours=24]
 * @param {number} [options.minBaselineDays=3]
 * @param {number} [options.emergentMinShare=0.05]
 * @param {number} [options.emergentMinPosts=10]
 * @param {object} [options.weights]
 * @param {ReadonlyArray<{ max: number, weight: number }>} [options.followerBands]
 */
export function createNarrativeTracker(options = {}) {
  const opts = options || {};
  const db = opts.db || getDatabase();
  const healthFn = typeof opts.healthFn === 'function' ? opts.healthFn : () => ({ degraded: false });
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const taxonomy = Array.isArray(opts.taxonomy) ? opts.taxonomy : loadDefaultTaxonomy();
  const defaultHours = typeof opts.hours === 'number' && opts.hours > 0 ? opts.hours : DEFAULT_HOURS;
  const minBaselineDays = typeof opts.minBaselineDays === 'number' && opts.minBaselineDays > 0
    ? opts.minBaselineDays
    : DEFAULT_MIN_BASELINE_DAYS;
  const emergentMinShare = typeof opts.emergentMinShare === 'number' && opts.emergentMinShare > 0
    ? opts.emergentMinShare
    : DEFAULT_EMERGENT_MIN_SHARE;
  const emergentMinPosts = typeof opts.emergentMinPosts === 'number' && opts.emergentMinPosts > 0
    ? opts.emergentMinPosts
    : DEFAULT_EMERGENT_MIN_POSTS;
  const weights = opts.weights || DEFAULT_WEIGHTS;
  const followerBands = opts.followerBands || DEFAULT_FOLLOWER_BANDS;

  // Track taxonomy lookup map (id -> label)
  const taxonomyLabelMap = new Map();
  for (const cat of taxonomy) {
    taxonomyLabelMap.set(cat.id, cat.label);
  }
  taxonomyLabelMap.set('__other__', 'Other');

  // --- Ensure Schema (Idempotent) ---
  function initSchema() {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS narrative_assignments (
          source_id TEXT PRIMARY KEY,
          narrative_id TEXT NOT NULL,
          ts INTEGER NOT NULL,
          via TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_narr_assign_ts ON narrative_assignments (ts);
        CREATE INDEX IF NOT EXISTS idx_narr_assign_id ON narrative_assignments (narrative_id);

        CREATE TABLE IF NOT EXISTS narrative_labels (
          narrative_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          keywords TEXT,
          emergent INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);

      // Idempotently add content column to token_mentions if table exists and column missing
      try {
        const tableCheck = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='token_mentions'"
        ).get();
        if (tableCheck) {
          const colInfo = db.prepare("PRAGMA table_info('token_mentions')").all();
          const hasContent = colInfo.some((c) => c.name === 'content');
          if (!hasContent) {
            db.exec('ALTER TABLE token_mentions ADD COLUMN content TEXT');
          }
        }
      } catch {
        // Ignore alter table errors
      }

      // Seed narrative_labels from taxonomy
      const insertLabel = db.prepare(`
        INSERT OR IGNORE INTO narrative_labels (narrative_id, label, keywords, emergent, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const tInit = now();
      for (const cat of taxonomy) {
        insertLabel.run(
          cat.id,
          cat.label,
          JSON.stringify(cat.keywords || []),
          0,
          tInit
        );
      }
      insertLabel.run('__other__', 'Other', '[]', 0, tInit);
    } catch {
      // Ignore schema init errors on missing DB
    }
  }

  initSchema();

  // --- Default classifyFn via JevBrain if not supplied ---
  const classifyFn = typeof opts.classifyFn === 'function'
    ? opts.classifyFn
    : async (posts) => {
        if (!posts || posts.length === 0) return [];
        try {
          const { JevBrain } = await import('../agents/jevBrain.js');
          const brain = new JevBrain();
          const candidateCategories = taxonomy.map(c => ({ id: c.id, label: c.label }));
          candidateCategories.push({ id: '__other__', label: 'Other / Unrelated' });

          const requests = posts.map(p => ({
            state: {
              text: p.text,
              candidateNarratives: candidateCategories,
            },
            questions: [
              {
                id: 'narrative',
                type: 'choice',
                instructions: {
                  prompt: 'Which crypto narrative does this post primarily discuss? Pick one category id or __other__.',
                },
                criteria: Object.fromEntries(candidateCategories.map(c => [c.id, c.label])),
              },
            ],
          }));

          const results = await brain.batchDecide(requests);
          const mapped = posts.map((p, idx) => {
            const r = results?.[idx];
            const choice = r?.answers?.narrative?.choice;
            return {
              id: p.id,
              narrativeId: (choice && typeof choice === 'string') ? choice : null,
            };
          });

          // P7: if the classification results are unusable (all null/missing narrativeId), throw so caller falls through to keyword
          const hasUsable = mapped.some((m) => m.narrativeId !== null);
          if (!hasUsable) {
            throw new Error('JevBrain returned unusable results (all null/missing narrativeId)');
          }

          return mapped.map((m) => ({
            id: m.id,
            narrativeId: m.narrativeId || '__other__',
          }));
        } catch {
          // If JevBrain fails, trigger keyword fallback
          throw new Error('JevBrain classification failed');
        }
      };

  // --- Helper: Deduplicate mentions by source_id for narrative corpus aggregation (Design Note 1) ---
  function dedupMentionsBySource(rows) {
    if (!rows || rows.length === 0) return [];
    const seen = new Set();
    const result = [];
    for (const r of rows) {
      if (!seen.has(r.source_id)) {
        seen.add(r.source_id);
        result.push(r);
      }
    }
    return result;
  }

  // --- Helper: Query mentions within a time window ---
  function queryMentions(startTime, endTime) {
    try {
      const rows = db.prepare(`
        SELECT
          source_id,
          token_id,
          author,
          followers,
          engagement,
          content,
          ts
        FROM token_mentions
        WHERE ts >= ? AND ts < ? AND content IS NOT NULL
      `).all(startTime, endTime);
      return rows;
    } catch (err) {
      if (err && String(err.message).includes('no such table')) {
        return null; // Signals uninitialized table
      }
      throw err;
    }
  }

  // --- Helper: Ensure assignments for unclassified posts ---
  async function ensureAssignments(mentions, isDegraded) {
    if (!mentions || mentions.length === 0) return new Map();

    // 1. Find existing assignments
    const sourceIds = [...new Set(mentions.map((m) => m.source_id))];
    const existingMap = new Map();

    const chunkSize = 500;
    for (let i = 0; i < sourceIds.length; i += chunkSize) {
      const chunk = sourceIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT source_id, narrative_id, ts, via FROM narrative_assignments WHERE source_id IN (${placeholders})`
      ).all(...chunk);
      for (const r of rows) {
        existingMap.set(r.source_id, r.narrative_id);
      }
    }

    // 2. Identify missing posts with non-empty content
    const unassignedPosts = [];
    const unassignedSourceIds = new Set();
    for (const m of mentions) {
      if (!existingMap.has(m.source_id) && !unassignedSourceIds.has(m.source_id)) {
        unassignedSourceIds.add(m.source_id);
        unassignedPosts.push({
          id: m.source_id,
          text: typeof m.content === 'string' ? m.content : '',
          ts: m.ts || now(),
        });
      }
    }

    if (unassignedPosts.length === 0) {
      return existingMap;
    }

    // 3. Classify unassigned posts
    const newAssignments = [];
    let classifiedViaJev = false;

    if (!isDegraded) {
      try {
        const postsToClassify = unassignedPosts.map(p => ({ id: p.id, text: p.text }));
        const classifications = (await classifyFn(postsToClassify)) || [];
        const resMap = new Map();
        for (const c of classifications) {
          if (c && c.id) resMap.set(c.id, c.narrativeId || '__other__');
        }
        // A classifyFn that returns null/undefined/[] with posts to classify
        // is treated as failed — fall through to keyword fallback.
        if (resMap.size === 0 && unassignedPosts.length > 0) {
          throw new Error('classifyFn returned no usable classifications');
        }

        for (const p of unassignedPosts) {
          const narrId = resMap.get(p.id) || '__other__';
          newAssignments.push({
            source_id: p.id,
            narrative_id: narrId,
            ts: p.ts,
            via: 'jev',
          });
        }
        classifiedViaJev = true;
      } catch {
        classifiedViaJev = false;
      }
    }

    // Fallback to keywordMatch if degraded or classifyFn failed
    if (!classifiedViaJev) {
      for (const p of unassignedPosts) {
        const narrId = keywordMatch(p.text, taxonomy);
        newAssignments.push({
          source_id: p.id,
          narrative_id: narrId,
          ts: p.ts,
          via: 'keyword',
        });
      }
    }

    // 4. Persist new assignments to DB
    const insertAssign = db.prepare(`
      INSERT OR REPLACE INTO narrative_assignments (source_id, narrative_id, ts, via)
      VALUES (?, ?, ?, ?)
    `);

    try {
      const insertMany = db.transaction((items) => {
        for (const it of items) {
          insertAssign.run(it.source_id, it.narrative_id, it.ts, it.via);
        }
      });
      insertMany(newAssignments);
    } catch {
      for (const it of newAssignments) {
        try {
          insertAssign.run(it.source_id, it.narrative_id, it.ts, it.via);
        } catch {
          // ignore
        }
      }
    }

    for (const a of newAssignments) {
      existingMap.set(a.source_id, a.narrative_id);
    }

    return existingMap;
  }

  // --- Helper: Promote emergent narratives from __other__ posts ---
  function discoverEmergentNarratives(activeMentions, assignmentsMap, totalActiveWeight) {
    if (!activeMentions || activeMentions.length === 0 || totalActiveWeight <= 0) return;

    const otherPosts = [];
    for (const m of activeMentions) {
      if (assignmentsMap.get(m.source_id) === '__other__') {
        const rowWeight = computeRowWeight(m, followerBands, weights);
        otherPosts.push({
          source_id: m.source_id,
          content: m.content || '',
          weight: rowWeight,
          ts: m.ts,
        });
      }
    }

    if (otherPosts.length < emergentMinPosts) return;

    const bigramStats = new Map();
    for (const p of otherPosts) {
      const bigrams = extractBigrams(p.content);
      for (const bg of bigrams) {
        let stat = bigramStats.get(bg);
        if (!stat) {
          stat = { count: 0, totalWeight: 0, sourceIds: new Set() };
          bigramStats.set(bg, stat);
        }
        stat.count += 1;
        stat.totalWeight += p.weight;
        stat.sourceIds.add(p.source_id);
      }
    }

    const candidates = [];
    for (const [bg, stat] of bigramStats.entries()) {
      const share = stat.totalWeight / totalActiveWeight;
      if (stat.count >= emergentMinPosts && share >= emergentMinShare) {
        candidates.push({ bigram: bg, ...stat, share });
      }
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => b.totalWeight - a.totalWeight || b.count - a.count);
    const top = candidates[0];
    const newNarrativeId = `emerging:${top.bigram}`;
    const newLabel = `Emerging: ${top.bigram}`;

    try {
      const insertLabel = db.prepare(`
        INSERT OR REPLACE INTO narrative_labels (narrative_id, label, keywords, emergent, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertLabel.run(
        newNarrativeId,
        newLabel,
        JSON.stringify([top.bigram]),
        1,
        now()
      );
      taxonomyLabelMap.set(newNarrativeId, newLabel);
    } catch {
      // ignore
    }

    const updateAssign = db.prepare(`
      UPDATE narrative_assignments
      SET narrative_id = ?, via = ?
      WHERE source_id = ?
    `);

    const idsToReassign = [...top.sourceIds];
    try {
      const reassignTx = db.transaction((ids) => {
        for (const sid of ids) {
          updateAssign.run(newNarrativeId, 'emergent_clustering', sid);
        }
      });
      reassignTx(idsToReassign);
    } catch {
      for (const sid of idsToReassign) {
        try {
          updateAssign.run(newNarrativeId, 'emergent_clustering', sid);
        } catch {
          // ignore
        }
      }
    }

    for (const sid of idsToReassign) {
      assignmentsMap.set(sid, newNarrativeId);
    }
  }

  // --- Helper: Read all known narrative labels from DB ---
  function getKnownLabels() {
    const labelMap = new Map(taxonomyLabelMap);
    try {
      const rows = db.prepare('SELECT narrative_id, label, emergent FROM narrative_labels').all();
      for (const r of rows) {
        labelMap.set(r.narrative_id, r.label);
      }
    } catch {
      // ignore
    }
    return labelMap;
  }

  // ============================================================================
  // Core Method: computeNarratives()
  // ============================================================================

  /**
   * Computes narrative mindshare percentages and deltas.
   *
   * @param {object} [options]
   * @param {number} [options.hours=24]
   * @returns {Promise<{
   *   narratives: Array<{
   *     id: string,
   *     label: string,
   *     mindsharePct: number,
   *     delta24h: number|null,
   *     delta7d: number|null,
   *     emerging?: boolean,
   *     insufficientHistory?: boolean
   *   }>,
   *   degraded: boolean,
   *   scope: string,
   *   windowHours: number,
   *   warning?: string,
   *   consecutiveEmptyBatches?: number,
   *   degradedSince?: number,
   *   generatedAt: string
   * }>}
   */
  async function computeNarratives(options = {}) {
    const calcOpts = options || {};
    const hoursRaw = Number(calcOpts.hours);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : defaultHours;
    const activeWindowMs = hours * HOUR_MS;
    const t = now();

    let health = { degraded: false };
    try {
      health = healthFn() || { degraded: false };
    } catch {
      health = { degraded: false };
    }
    const isDegraded = health.degraded === true;

    const activeMentionsRaw = queryMentions(t - activeWindowMs, t);

    if (activeMentionsRaw === null) {
      return {
        narratives: [],
        degraded: isDegraded,
        scope: 'watchlist',
        windowHours: hours,
        warning: 'token_mentions table not initialized',
        ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
        ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
        generatedAt: new Date(t).toISOString(),
      };
    }

    if (isDegraded && activeMentionsRaw.length === 0) {
      return {
        narratives: [],
        degraded: true,
        scope: 'watchlist',
        windowHours: hours,
        ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
        ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
        generatedAt: new Date(t).toISOString(),
      };
    }

    if (activeMentionsRaw.length === 0) {
      return {
        narratives: [],
        degraded: isDegraded,
        scope: 'watchlist',
        windowHours: hours,
        generatedAt: new Date(t).toISOString(),
      };
    }

    const activeMentions = dedupMentionsBySource(activeMentionsRaw);
    const assignmentsMap = await ensureAssignments(activeMentions, isDegraded);

    let totalActiveWeight = 0;
    const activeWeightsByNarrative = new Map();

    for (const m of activeMentions) {
      const w = computeRowWeight(m, followerBands, weights);
      const narrId = assignmentsMap.get(m.source_id) || '__other__';
      totalActiveWeight += w;
      activeWeightsByNarrative.set(narrId, (activeWeightsByNarrative.get(narrId) || 0) + w);
    }

    discoverEmergentNarratives(activeMentions, assignmentsMap, totalActiveWeight);

    totalActiveWeight = 0;
    activeWeightsByNarrative.clear();
    for (const m of activeMentions) {
      const w = computeRowWeight(m, followerBands, weights);
      const narrId = assignmentsMap.get(m.source_id) || '__other__';
      totalActiveWeight += w;
      activeWeightsByNarrative.set(narrId, (activeWeightsByNarrative.get(narrId) || 0) + w);
    }

    const prev24hMentions = dedupMentionsBySource(queryMentions(t - 2 * WINDOW_24H_MS, t - WINDOW_24H_MS));
    let totalPrev24hWeight = 0;
    const prev24hWeightsByNarrative = new Map();
    if (prev24hMentions.length > 0) {
      const prev24hAssignments = await ensureAssignments(prev24hMentions, isDegraded);
      for (const m of prev24hMentions) {
        const w = computeRowWeight(m, followerBands, weights);
        const narrId = prev24hAssignments.get(m.source_id) || '__other__';
        totalPrev24hWeight += w;
        prev24hWeightsByNarrative.set(narrId, (prev24hWeightsByNarrative.get(narrId) || 0) + w);
      }
    }

    let totalCurr24hWeight = totalActiveWeight;
    let curr24hWeightsByNarrative = activeWeightsByNarrative;
    if (activeWindowMs !== WINDOW_24H_MS) {
      const curr24hMentions = dedupMentionsBySource(queryMentions(t - WINDOW_24H_MS, t));
      const curr24hAssigns = await ensureAssignments(curr24hMentions, isDegraded);
      totalCurr24hWeight = 0;
      curr24hWeightsByNarrative = new Map();
      for (const m of curr24hMentions) {
        const w = computeRowWeight(m, followerBands, weights);
        const narrId = curr24hAssigns.get(m.source_id) || '__other__';
        totalCurr24hWeight += w;
        curr24hWeightsByNarrative.set(narrId, (curr24hWeightsByNarrative.get(narrId) || 0) + w);
      }
    }

    const curr7dMentions = dedupMentionsBySource(queryMentions(t - WINDOW_7D_MS, t));
    let totalCurr7dWeight = 0;
    const curr7dWeightsByNarrative = new Map();
    if (curr7dMentions.length > 0) {
      const curr7dAssigns = await ensureAssignments(curr7dMentions, isDegraded);
      for (const m of curr7dMentions) {
        const w = computeRowWeight(m, followerBands, weights);
        const narrId = curr7dAssigns.get(m.source_id) || '__other__';
        totalCurr7dWeight += w;
        curr7dWeightsByNarrative.set(narrId, (curr7dWeightsByNarrative.get(narrId) || 0) + w);
      }
    }

    const prev7dMentions = dedupMentionsBySource(queryMentions(t - 2 * WINDOW_7D_MS, t - WINDOW_7D_MS));
    let totalPrev7dWeight = 0;
    const prev7dWeightsByNarrative = new Map();
    const baselineDailyMap = new Map();

    if (prev7dMentions.length > 0) {
      const prev7dAssigns = await ensureAssignments(prev7dMentions, isDegraded);
      for (const m of prev7dMentions) {
        const w = computeRowWeight(m, followerBands, weights);
        const narrId = prev7dAssigns.get(m.source_id) || '__other__';
        totalPrev7dWeight += w;
        prev7dWeightsByNarrative.set(narrId, (prev7dWeightsByNarrative.get(narrId) || 0) + w);

        const dayIndex = Math.floor(m.ts / DAY_MS);
        let dayBucket = baselineDailyMap.get(dayIndex);
        if (!dayBucket) {
          dayBucket = { totalWeight: 0, narrWeights: new Map() };
          baselineDailyMap.set(dayIndex, dayBucket);
        }
        dayBucket.totalWeight += w;
        dayBucket.narrWeights.set(narrId, (dayBucket.narrWeights.get(narrId) || 0) + w);
      }
    }

    const baselineStats = new Map();
    for (const [narrId] of activeWeightsByNarrative.entries()) {
      const dailyShares = [];
      for (const dayBucket of baselineDailyMap.values()) {
        if (dayBucket.totalWeight > 0) {
          const nw = dayBucket.narrWeights.get(narrId) || 0;
          dailyShares.push((nw / dayBucket.totalWeight) * 100);
        }
      }

      if (dailyShares.length >= minBaselineDays) {
        const mean = dailyShares.reduce((acc, s) => acc + s, 0) / dailyShares.length;
        const variance = dailyShares.reduce((acc, s) => acc + (s - mean) ** 2, 0) / dailyShares.length;
        const sigma = Math.sqrt(variance);
        baselineStats.set(narrId, { mean, sigma, distinctDays: dailyShares.length });
      }
    }

    const allLabels = getKnownLabels();
    const narrativeItems = [];

    for (const [narrId, weight] of activeWeightsByNarrative.entries()) {
      const mindsharePct = totalActiveWeight > 0 ? (weight / totalActiveWeight) * 100 : 0;

      let delta24h = null;
      if (totalPrev24hWeight > 0 && totalCurr24hWeight > 0) {
        const currShare = ((curr24hWeightsByNarrative.get(narrId) || 0) / totalCurr24hWeight) * 100;
        const prevShare = ((prev24hWeightsByNarrative.get(narrId) || 0) / totalPrev24hWeight) * 100;
        delta24h = currShare - prevShare;
      }

      let delta7d = null;
      let insufficientHistory = false;
      const bStat = baselineStats.get(narrId);

      if (!bStat || bStat.distinctDays < minBaselineDays || totalPrev7dWeight === 0) {
        insufficientHistory = true;
        delta7d = null;
      } else {
        const curr7dShare = totalCurr7dWeight > 0
          ? ((curr7dWeightsByNarrative.get(narrId) || 0) / totalCurr7dWeight) * 100
          : 0;
        const prev7dShare = ((prev7dWeightsByNarrative.get(narrId) || 0) / totalPrev7dWeight) * 100;
        delta7d = curr7dShare - prev7dShare;
      }

      let emerging = false;
      if (bStat && bStat.distinctDays >= minBaselineDays) {
        if (bStat.sigma > 0 && mindsharePct > bStat.mean + 3 * bStat.sigma) {
          emerging = true;
        }
      } else if (narrId.startsWith('emerging:')) {
        emerging = true;
      }

      const item = {
        id: narrId,
        label: allLabels.get(narrId) || narrId,
        mindsharePct,
        delta24h,
        delta7d,
        ...(emerging ? { emerging: true } : {}),
        ...(insufficientHistory ? { insufficientHistory: true } : {}),
      };

      narrativeItems.push(item);
    }

    narrativeItems.sort((a, b) => b.mindsharePct - a.mindsharePct);

    return {
      narratives: narrativeItems,
      degraded: isDegraded,
      scope: 'watchlist',
      windowHours: hours,
      ...(health.consecutiveEmptyBatches !== undefined ? { consecutiveEmptyBatches: health.consecutiveEmptyBatches } : {}),
      ...(health.degradedSince !== undefined ? { degradedSince: health.degradedSince } : {}),
      generatedAt: new Date(t).toISOString(),
    };
  }

  // ============================================================================
  // Token Narrative Mapping: tokenNarratives()
  // ============================================================================

  /**
   * Returns token -> { narrativeId, narrativeDelta } mapping via plurality vote.
   *
   * @param {object} [options]
   * @param {number} [options.hours=24]
   * @returns {Promise<Map<string, { narrativeId: string, narrativeDelta: number|null }>>}
   */
  async function tokenNarratives(options = {}) {
    const hours = typeof options?.hours === 'number' && options.hours > 0 ? options.hours : defaultHours;
    const activeWindowMs = hours * HOUR_MS;
    const t = now();

    let health = { degraded: false };
    try {
      health = healthFn() || { degraded: false };
    } catch {
      health = { degraded: false };
    }
    const isDegraded = health.degraded === true;

    const narrativesResult = await computeNarratives({ hours });
    const deltaMap = new Map();
    for (const n of narrativesResult.narratives) {
      deltaMap.set(n.id, n.delta24h);
    }

    const mentions = queryMentions(t - activeWindowMs, t) || [];
    if (mentions.length === 0) {
      return new Map();
    }

    const assignmentsMap = await ensureAssignments(mentions, isDegraded);

    const tokenNarrativeWeights = new Map();
    for (const m of mentions) {
      if (!m.token_id) continue;
      const tid = String(m.token_id).trim().toLowerCase();
      if (!tid) continue;

      const w = computeRowWeight(m, followerBands, weights);
      const narrId = assignmentsMap.get(m.source_id) || '__other__';

      let narrMap = tokenNarrativeWeights.get(tid);
      if (!narrMap) {
        narrMap = new Map();
        tokenNarrativeWeights.set(tid, narrMap);
      }
      narrMap.set(narrId, (narrMap.get(narrId) || 0) + w);
    }

    const result = new Map();
    for (const [tid, narrMap] of tokenNarrativeWeights.entries()) {
      let bestNarrativeId = null;
      let maxWeight = -1;
      for (const [nid, w] of narrMap.entries()) {
        if (w > maxWeight) {
          maxWeight = w;
          bestNarrativeId = nid;
        }
      }

      if (bestNarrativeId) {
        const delta = deltaMap.has(bestNarrativeId) ? deltaMap.get(bestNarrativeId) : null;
        result.set(tid, {
          narrativeId: bestNarrativeId,
          narrativeDelta: delta,
        });
      }
    }

    return result;
  }

  // ============================================================================
  // Emerging Narratives Helper: emergingNarratives()
  // ============================================================================

  /**
   * Helper returning only emerging narratives.
   *
   * @param {object} [options]
   * @returns {Promise<Array<object>>}
   */
  async function emergingNarratives(options = {}) {
    const res = await computeNarratives(options);
    return res.narratives.filter(n => n.emerging === true);
  }

  return {
    computeNarratives,
    tokenNarratives,
    emergingNarratives,
    keywordMatch: (text) => keywordMatch(text, taxonomy),
    extractBigrams,
  };
}

// ============================================================================
// Singleton Default Instance
// ============================================================================

/** @type {ReturnType<typeof createNarrativeTracker> | null} */
let defaultTrackerInstance = null;

/**
 * Returns default singleton NarrativeTracker using process-level DB & config.
 * @returns {ReturnType<typeof createNarrativeTracker>}
 */
export function getDefaultNarrativeTracker() {
  if (!defaultTrackerInstance) {
    defaultTrackerInstance = createNarrativeTracker();
  }
  return defaultTrackerInstance;
}

/**
 * Resets default singleton for test isolation.
 */
export function resetDefaultNarrativeTracker() {
  defaultTrackerInstance = null;
}
