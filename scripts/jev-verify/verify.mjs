#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). MIT License.
// XActions — Jev verification harness
// Đo Jev trên corpus tweet thật: Việt/slang/mixed/English + spam detection.
// Chạy: TYPESAFE_API_KEY=... node scripts/jev-verify/verify.mjs [--mock]
//
// --mock: không gọi API, in request shape + giả lập để kiểm format.
// by nichxbt

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));
const MOCK = process.argv.includes('--mock');
const API_KEY = process.env.TYPESAFE_API_KEY;
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

// ── Question set (giống sẽ dùng trong jevBrain.js) ───────────────
function buildQuestions(keywords) {
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
      instructions: 'This post is spam, bait, airdrop-farming, or low-effort promotion',
    },
    replyWorthy: {
      type: 'noul',
      instructions: 'A genuine, value-adding reply is likely to be well received here',
    },
  };
}

async function callJev(item, questions) {
  const state = { tweet: item.text, author: item.author, nicheKeywords: corpus.nicheKeywords };
  const body = { state, model: 'jev-latest', questions };

  if (MOCK) {
    return { _mock: true, requestBody: body };
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Jev ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function evaluate(item, answers) {
  // map score levels to numeric relevance (0-3 → 0-100)
  const relScore = answers.relevance?.score ?? null;
  const relConf = answers.relevance?.confidence ?? null;
  const action = answers.action?.choice ?? null;
  const actConf = answers.action?.confidence ?? null;
  const spam = answers.isSpam?.noul ?? null;         // 0..1
  const replyW = answers.replyWorthy?.noul ?? null;

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

// ── main ─────────────────────────────────────────────────────────
console.log(`🧪 Jev verify — ${corpus.items.length} items ${MOCK ? '(MOCK — no API call)' : ''}`);
if (!MOCK && !API_KEY) {
  console.error('❌ TYPESAFE_API_KEY not set. Run with --mock to preview request shape.');
  process.exit(1);
}

const questions = buildQuestions(corpus.nicheKeywords);
const results = [];
let totTokens = { in: 0, out: 0 };
const t0 = Date.now();

for (const item of corpus.items) {
  try {
    const res = await callJev(item, questions);
    if (res._mock) {
      console.log(`\n[MOCK request for ${item.id}]`);
      console.log(JSON.stringify(res.requestBody, null, 2).slice(0, 1400));
      continue;
    }
    const ev = evaluate(item, res.answers);
    results.push(ev);
    totTokens.in += res.usage?.input_tokens || 0;
    totTokens.out += res.usage?.output_tokens || 0;
    console.log(`${ev.hit.relevant && ev.hit.spam ? '✅' : '⚠️ '} ${ev.id} [${ev.lang}] rel=${ev.relScore}(c${ev.relConf?.toFixed(2)}) act=${ev.action}(c${ev.actConf?.toFixed(2)}) spam=${ev.spam?.toFixed(2)} reply=${ev.replyW?.toFixed(2)}`);
  } catch (e) {
    console.log(`❌ ${item.id}: ${e.message}`);
  }
}

if (!MOCK && results.length) {
  const accRel = results.filter(r => r.hit.relevant).length / results.length;
  const accSpam = results.filter(r => r.hit.spam).length / results.length;
  const byLang = {};
  for (const r of results) { (byLang[r.lang] ||= []).push(r.hit.relevant && r.hit.spam ? 1 : 0); }
  console.log('\n════════ RESULT ════════');
  console.log(`Relevance accuracy : ${(accRel * 100).toFixed(0)}%`);
  console.log(`Spam accuracy      : ${(accSpam * 100).toFixed(0)}%`);
  for (const [l, arr] of Object.entries(byLang)) {
    console.log(`  ${l}: ${(arr.reduce((a, b) => a + b, 0) / arr.length * 100).toFixed(0)}% (${arr.length})`);
  }
  console.log(`Tokens in/out      : ${totTokens.in}/${totTokens.out}`);
  console.log(`Wall time          : ${((Date.now() - t0) / 1000).toFixed(1)}s for ${results.length} calls`);
  const estCost = (totTokens.in / 1e9) * 42; // $42/B input tokens per TypeSafe
  console.log(`Est. input cost    : $${estCost.toFixed(6)}`);
}
