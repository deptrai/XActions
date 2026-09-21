# Epic 42 Context: Agentic Decision Plane — Jev Typed-Decision Integration

> **Mục đích tài liệu:** Đây là context document DUY NHẤT mà dev agent đọc để implement toàn bộ 9 stories của Epic 42. Nó tổng hợp: business context từ epics.md, verified idea từ forge (`forged-idea.md`), architecture invariants từ `docs/architecture.md` (§2.8, §5.6, AD-48), kết quả verify thật trên corpus 40 tweet, harness `scripts/jev-verify/`, và hiện trạng code cần thay đổi (`LLMBrain`, `thoughtLeaderAgent`).

---

## 1. Business Context (từ `epics.md`)

Mọi quyết định "có nên like/reply/follow không" trong XActions hiện đi qua generative LLM (`LLMBrain`, `callLLM`) hoặc heuristic thô (`Math.random()`, ngưỡng cứng `score>60/>80`). Điều này gây 3 vấn đề:

1. **Tốn chi phí** — trả tiền token sinh text chỉ để `parseInt` vứt đi.
2. **Không tin cậy** — `JSON.parse`/`regex` parse rác, `catch → return default`.
3. **Không tự chủ được** — không có confidence calibrated để biết "khi nào không chắc" → escalate, buộc phải giám sát.

Epic này đưa **TypeSafe Jev** (System One model) vào làm **Decision Plane** riêng (xem `docs/architecture.md` §2.8, AD-48): Jev trả typed verdict `{choice|score|noul, probabilities, confidence}`, LLM chỉ giữ vai trò sinh prose. Verified trên corpus 40 tweet (`scripts/jev-verify/`): relevance 85%, spam 98%, vi 92%/mixed 100%/en 79%, ~$0.024/1000 tweet.

### Phân vai cốt lõi (từ forge — quyết định khóa)

- **Jev = Decision Engine riêng** (`src/agents/jevBrain.js`), KHÔNG phải LLM provider thứ 4 trong `llmBrain`. `systemOne` không phải `chat/completions` — "drop-in" là ảo giác đã bị bác.
- **Phân vai:** Jev = não quyết định (typed judgment + confidence). LLM = miệng viết (chỉ prose).
- **Luồng:** `state + questions → confidence gate (per-action, user-tunable) → act | queue-review | skip → nếu cần prose → LLMBrain`.
- **Cơ chế chạm pain X-flag-vì-hành-vi:** Jev là **volume reducer** — chỉ act khi confidence cao → ít action ngu → pattern ít bot-like. Chỉ đúng nếu dùng để *làm ít đi*, không phải làm nhiều hơn.

### Mục tiêu đã verify là thật

- **Chi phí: ✅ thật** — mọi judgment đang gọi LLM (sinh text rồi `parseInt` vứt) → Jev rẻ ~200–400×, 1 call nhiều question song song.
- **Chất lượng: ✅ thật** — typed output + calibrated confidence thay `parseInt(regex)` và `JSON.parse` catch→default. Biết "không chắc" → escalate.
- **Speed: ⚠️ có điều kiện** — realtime loop bị X rate-limit đè (model speed vô nghĩa); chỉ đếm được ở batch (audit/score hàng loạt).

### Đã bị bác (rejected hypotheses)

- Jev-as-LLM-provider drop-in (sai API shape).
- Jev chữa X-flag trực tiếp (nó judge text, không đọc rate-limit/shadowban).
- Cắm vào `generateReply`/`generateContent`/`analyzeStrategy` (Jev không sinh prose).

---

## 2. Verified API Contract

### Endpoint

- **`POST https://api.typesafe.ai/v1/systemone`**
- Auth: `Authorization: Bearer ${TYPESAFE_API_KEY}`
- Header: `Content-Type: application/json`
- Model: `jev-latest`
- REST thẳng bằng `fetch` (reuse retry/rate-limit shell của `LLMBrain`), **né** `@typesafe-ai/sdk` dep. Node engine `>=20.18.1` có native `fetch` → không blocking.

### Request shape (từ harness `verify.mjs` — format đã chạy thật)

```js
const body = {
  state: { tweet, author, nicheKeywords },   // string | object | array — TEXT-ONLY
  model: 'jev-latest',
  questions: {
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
  },
};
```

### Response shape

```js
{
  answers: {
    relevance: { score: 0..3, confidence: 0..1 },        // Score
    action:    { choice: 'ignore|like|bookmark|reply|quote', confidence: 0..1 },  // Choice
    isSpam:    { noul: 0..1 },                            // Noul — KHÔNG có confidence field
    replyWorthy: { noul: 0..1 },
  },
  usage: { input_tokens, output_tokens },
}
```

### Ba primitives

| Primitive | Trả về | Dùng cho | Ghi chú |
|---|---|---|---|
| **Choice** | `{choice, probabilities, confidence}` | action router (ignore/like/bookmark/reply/quote/follow), xspace DecisionEngine, pageStatus, buyerIntent, variant selector, relationship verdict | Đáng tin nhất — "Jev route đúng action kể cả khi score thấp" |
| **Score** | `{score (theo criteria levels), confidence}` | `scoreRelevance`, spam/quality scoring, ICP fit, samePerson, comment opportunity | Score là phụ — trần accuracy (79% en) |
| **Noul** | `{noul: 0..1}` — boolean-like | `checkPersonaConsistency`, pre-write safety gate, `replyWorthy`, isSpam, brand-safety, cringe factor | **KHÔNG có `confidence` field** → tự threshold trên `noul` value (thực hành harness: `noul >= 0.6` = positive) |

Một call `systemOne` có thể **mix cả 3 primitives** vào cùng một `state`; questions evaluate song song ở near-constant latency (~300ms/call với 4 questions).

### Constraint (từ AD-48)

- State **text-only** — không media/avatar/rate-limit signal.
- **English-primary** nhưng verified mạnh trên vi/mixed corpus.
- Noul carries no `confidence` field.

---

## 3. Verification Results (40-item corpus, đã chạy API thật)

Harness: `scripts/jev-verify/verify.mjs` · Corpus: `scripts/jev-verify/corpus.json` (40 tweet: Việt/English/mixed/slang/link/mention/hashtag/ngắn/sarcasm/edge-case; ground truth do người gán; niche `ai-tools-vietnam`).

| Metric | Kết quả |
|---|---|
| Relevance accuracy | 85% (threshold: `score >= 2` trên levels `[irrelevant, marginal, clearly relevant, core topic]`) |
| Spam accuracy | **98%** (threshold: `noul >= 0.6`) |
| vi / mixed / en accuracy | 92% / 100% / 79% |
| Cost | run10=$0.00024 · run40=$0.00097 → **≈ $0.024/1000 tweet** (1M ≈ $24) |
| Latency | ~300ms/call (4 questions mỗi call) |
| Cost model | ~$42/B input tokens (TypeSafe public pricing; harness tính `estCost = (in/1e9) * 42`) |

**Insight quan trọng:** `action` (Choice) đáng tin hơn `relevance` (Score trần) — Jev route đúng action kể cả khi score thấp. → `jevBrain` ưu tiên **Choice router**, Score làm phụ.

**Crack đã giải:** #1 Việt/slang — Jev đọc tốt (92–100%). #2 cost/speed — rẻ+nhanh thật ở batch. #3 fallback — khóa design (giữ LLMBrain).

**Crack còn lại:** self-promo bị nhận spam (false-positive) → nới `isSpam` criteria (tách "self-promo" khỏi "scam/airdrop"). Corpus nhỏ — test định kỳ trên data production.

---

## 4. Architecture Invariants

### §2.8 Agentic Decision Plane — Jev (`docs/architecture.md`)

The agentic subsystems (`src/agents/`, `src/algorithmBuilder.js`, `src/personaEngine.js`, `xspace-agents`, `python/xeepy/ai/`) currently make every judgment through generative LLMs (`LLMBrain`, `callLLM`) or bare heuristics (`Math.random()`, magic-number thresholds like `score>60`). This conflates two distinct concerns:

- **Generation** (prose: replies, tweets, threads) — stays on generative LLMs.
- **Decision** (judgment: relevant? act? safe? spam?) — moved to a dedicated typed-decision plane powered by **TypeSafe Jev**, a *System One* model that returns `{choice|score|noul, probabilities, confidence}` instead of generated text.

```
 tweet / DM / notif / follower / transcript  (text-only state)
        |
        v
  JevBrain.systemOne({ state, questions })
        |   { choice|score|noul, probabilities, confidence }
        v
  Confidence Gate   (per-action, user-tunable thresholds)
        |   conf >= hi -> act | mid -> queue review | lo -> skip
        v
  needs prose? --yes--> LLMBrain (mid/smart) --> JevBrain safety Noul --> execute
        |no
        v
     execute / log
```

- **Boundary rule:** Jev evaluates *text state only* (no media/avatar/rate-limit signal) and answers *judgment questions* — it never generates prose and never sits in deterministic critical-path logic.
- **Volume-reducer effect:** gating on calibrated confidence cuts low-value actions, yielding fewer bot-like patterns and lower X flag exposure (the dominant failure mode is behavioral/tempo flagging, not content quality).
- **Primitives mapping:** `Choice` → action router; `Score` → `scoreRelevance`, spam/quality, xspace DecisionEngine; `Noul` → `checkPersonaConsistency`, pre-write safety gate, `replyWorthy`.
- **Fallback:** `LLMBrain` remains the fallback decision path when `TYPESAFE_API_KEY` is unset or Jev errors — the plane degrades, it never hard-fails.
- **Cost model:** ~$42/B input tokens; `DistributedTokenBucket` can meter `jev:*` keys alongside the proxy budget (AD-42).
- Tech stack matrix ghi nhận: **Decision Engine** = TypeSafe Jev (`/v1/systemone`) — typed decisions + calibrated confidence (Epic 42).

### §5.6 Jev Plane Isolation (AD-48) — invariant §5

- **All Jev calls route through `src/agents/jevBrain.js`.** No module calls `api.typesafe.ai` directly.
- On `TYPESAFE_API_KEY` absence or error, the plane degrades to `LLMBrain` judgment — **never hard-fails**.
- Confidence thresholds are **configurable per action, never hardcoded**.

Related §5 invariant 4 (No LLM in Critical Path Logic) — **Jev corollary:** decision questions (relevance/action/safety) may consult the Jev plane, but the *execution* of a chosen action and all rate/timing math remain deterministic. Jev is advisory to the control flow, never a blocking dependency of it.

### AD-48 (Agentic Decision Plane — Jev, Epic 42)

Typed-decision model `jev-latest` is introduced as a dedicated plane for *judgment* (relevance, action routing, spam/safety), distinct from generative *content* LLMs.

- **Contract:** `POST /v1/systemone { state: string|object|array, questions: {id: Choice|Score|Noul} }` → `{choice|score|noul, probabilities, confidence}`.
- **Constraints:** text-only state; English-primary (verified strong on vi/mixed corpus); Noul carries no `confidence` field.
- **Routing:** `jevBrain.js` sole gateway; confidence-gated action; `LLMBrain` fallback.
- **Verified corpus:** `scripts/jev-verify/`.

### AD-42 (Cost-Aware Proxy Escalation) — pattern để mirror cho cost governance

`ProxyBudgetGovernor` enforces `PROXY_DAILY_BUDGET_USD` ceiling; `BUDGET_CEILING_REACHED` soft degradation returns degraded result instead of throwing `PROXY_EXHAUSTED`. Daily budget ceilings atomically governed by `DistributedTokenBucket`. Epic 42 mirrors this: meter `jev:*` keys qua `DistributedTokenBucket` + `JEV_DAILY_BUDGET_USD` ceiling; `BUDGET_CEILING_REACHED` → degrade (fallback LLMBrain), không throw.

---

## 5. Confidence Gate Pattern

Per-action, user-tunable thresholds (KHÔNG hardcode — load từ config/env):

```
conf >= hi  → act
mid ≤ conf < hi  → queue-review
conf < mid  → skip
```

### Mapping function → primitive → state → threshold (từ forge)

| Chỗ | Primitive | State | Threshold |
|---|---|---|---|
| `llmBrain.scoreRelevance` | `Score` | `{tweet, niche}` | score≥"relevant" + conf≥0.7 |
| action router `thoughtLeaderAgent` (thay `>60/>80/rand<0.4`) | `Choice` | `{tweet, author, niche}` | per-action conf: like≥0.6, reply≥0.85 |
| `checkPersonaConsistency` | `Noul`+`Score` | `{text, persona}` | noul≥0.7 on-persona |
| `xspace DecisionEngine` | `Choice` | `{transcription, topic}` | respond/listen/backchannel + conf |
| `xeepy spam_detector/smart_targeting` | `Score`/`Choice` batch | `{profile, followers}` | batch — chỗ speed đếm được |
| Safety gate trước mỗi write | `Noul` | `{draft, context}` | noul≥0.8 safe-to-send |

Các ngưỡng trên là *điểm khởi đầu verified*, nhưng bắt buộc phải đưa vào config/persona/env — Story 42.1 AC yêu cầu "confidence threshold per-action load từ config/env — không hardcode".

---

## 6. LLM Fallback Degrade Triggers

`jevBrain` degrade sang `LLMBrain` judgment khi một trong các trigger sau (không hard-fail):

1. `TYPESAFE_API_KEY` vắng (unset env) → dùng LLMBrain ngay từ đầu.
2. HTTP **5xx** từ `api.typesafe.ai` (sau retry).
3. **Timeout > 5s** per call.
4. HTTP **429** (rate limit) — mirror retry/backoff của `LLMBrain._call` (3 attempts, exponential `2^attempt * 1000 + jitter`), sau đó degrade.

Thêm: `BUDGET_CEILING_REACHED` (JEV_DAILY_BUDGET_USD đã cạn) → degrade, không throw. Nói cách khác: **mọi failure path đều kết thúc ở LLMBrain judgment, không bao giờ throw lên caller của decision plane**.

---

## 7. Cost Governance

- Meter `jev:*` keys qua **`DistributedTokenBucket`** (Redis-based, đã có trong stack: "Redis + Bull MQ — Distributed token buckets").
- **`JEV_DAILY_BUDGET_USD`** ceiling — mirror AD-42 proxy budget pattern.
- Khi vượt ceiling → `BUDGET_CEILING_REACHED` → **soft degradation** (fallback LLMBrain judgment), KHÔNG throw.
- Cost target verified: ~$0.024/1000 tweets → 1M tweets ≈ $24/ngày nếu chạy max; budget ceiling chặn scenario này.

---

## 8. Full Scope — 9 Stories + ACs (từ `epics.md`)

### Trong scope

- `src/agents/jevBrain.js` — module gateway duy nhất tới `POST https://api.typesafe.ai/v1/systemone` (REST `fetch`, reuse retry/rate-limit shell của `LLMBrain`; né `@typesafe-ai/sdk` dep). API: `decide(state, questions)` → typed answers + confidence.
- **Confidence gate** — per-action, user-tunable thresholds (không hardcode): `conf ≥ hi → act · mid → queue-review · lo → skip`.
- **LLM fallback** — khi `TYPESAFE_API_KEY` vắng hoặc Jev lỗi → degrade sang `LLMBrain` judgment, không hard-fail (invariant §5.6).
- Adopt vào `thoughtLeaderAgent` (action router thay `>60/>80/random`), `checkPersonaConsistency` (Noul), safety `Noul` trước mỗi write, `xspace-agents DecisionEngine` (Choice), `xeepy` batch (spam/targeting Score/Choice).
- Verify harness `scripts/jev-verify/` chạy được như CI regression trên corpus.
- **Bề mặt mở rộng (Expanded Decision Surfaces):**
  1. Chẩn đoán Bot Challenge & Soft-200 đa nền tảng (`src/core/error-envelope.js`, `crawler-governor.js`).
  2. So khớp Bio ngữ nghĩa trong OSINT Entity Resolution (`src/mcp/osint-find-profiles.js`, `EntityResolver`).
  3. Phân loại Niche & Brand Safety Gate cho Trending Monitor (`src/trendingTopicMonitor.js`).
  4. Đánh giá Khách hàng Tiềm năng (B2B Lead Qualification & ICP Scoring) tốc độ cao (`api/routes/ai/leads.js`).
  5. Dọn dẹp Follower nhận thức (Cognitive Unfollow & giữ quan hệ VIP) (`src/unfollowback.js`).
  6. Trọng tài biến thể nội dung (Jev-as-a-Judge cho Tweet Generator & Cringe Filter) (`src/ai/tweetGenerator.js`).

### Ngoài scope (rejected)

- Jev sinh prose/reply/post (Jev không generate text — đó là `LLMBrain`).
- Jev đọc media/avatar/rate-limit (state text-only; không chữa trực tiếp X-flag vì hành vi).
- Thay `llmBrain` hoàn toàn — Jev là decision plane *song song*, không phải provider thay thế.
- Hardcode threshold — mọi ngưỡng phải config được (persona/env/config).

### Story 42.1: jevBrain-core-decision-plane

`src/agents/jevBrain.js` (REST client `systemOne`, primitives Choice/Score/Noul, confidence gate per-action, `LLMBrain` fallback).

- **AC:** sole gateway — mọi Jev call qua `jevBrain`; không module nào gọi `api.typesafe.ai` trực tiếp.
- **AC:** degrade-trigger rõ — `TYPESAFE_API_KEY` vắng | HTTP 5xx | timeout >5s | HTTP 429 → fallback `LLMBrain` judgment (không hard-fail).
- **AC:** cost governance — meter `jev:*` qua `DistributedTokenBucket` + `JEV_DAILY_BUDGET_USD` ceiling (mirror AD-42 proxy budget); `BUDGET_CEILING_REACHED` → degrade, không throw.
- **AC:** confidence threshold per-action load từ config/env — không hardcode.

### Story 42.2: agentic-adoption

Cắm `jevBrain` vào `thoughtLeaderAgent` action router + `algorithmBuilder`/`personaEngine` decisions + `checkPersonaConsistency` + safety `Noul` trước write + `xspace DecisionEngine` (Choice) + `xeepy` spam/targeting batch.

- **AC:** `xspace DecisionEngine` — Jev chạy **non-blocking**, song song với rule-engine; nếu Jev >500ms hoặc lỗi → dùng keyword/turn rule hiện có (voice loop không được khựng).
- **AC:** `thoughtLeaderAgent` — thay `score>60/>80`/`Math.random()<0.4` bằng `jevBrain` Choice + per-action confidence; mỗi action có threshold riêng.
- **AC:** safety `Noul` chạy trước MỌI write (reply/post/DM) — `safeToSend < threshold` → skip + log.

### Story 42.3: jev-verify-regression-guard

Nâng `scripts/jev-verify/` thành CI regression (corpus ≥50, accuracy floor vi≥85%/spam≥95%, drift alert khi accuracy tụt dưới ngưỡng).

### Story 42.4: jev-challenge-diagnostics — Soft-200 & Bot Challenge Diagnostics

- **AC:** Khi scraper nhận HTTP 200 nhưng trích xuất được 0 records hoặc body nghi ngờ checkpoint/soft-block, trích xuất 500 ký tự text và gọi `jevBrain.decide(snippet, { pageStatus: Choice(...) })`.
- **AC:** Nếu `pageStatus.choice` là `bot_challenge` hoặc `login_wall` với `confidence >= 0.8` → ném `BotChallengeError` (XACT_5030) và kích hoạt `AdaptiveRateGovernor.hibernateAccount()`.
- **AC:** Giảm thiểu sự phụ thuộc vào các chuỗi regex HTML tĩnh dễ gãy trên 26 nền tảng.

### Story 42.5: jev-osint-bio-matcher — Semantic Bio Matching for EntityResolver (Epic 41 / Option D)

- **AC:** Trong `EntityResolver.scorePair()`, khi so khớp 2 profile khác platform có bio text mà URL/exact username không match, gọi `jevBrain.decide({ bio1, bio2 }, { samePerson: Score(...) })`.
- **AC:** Nếu `samePerson.score >= 2` và `confidence >= 0.85` → cộng +35 điểm match vào pairwise score, giúp merge cluster những người có bio khác câu chữ nhưng cùng thực thể.
- **AC:** Tuân thủ nghiêm ngặt Option D (AD-45): tính toán in-memory per-request, tuyệt đối không lưu bio/cluster vào cơ sở dữ liệu.

### Story 42.6: jev-trend-brand-safety — Trending Topic Semantic Monitor & Brand Safety Gate

- **AC:** Thay thế từ điển `NICHE_KEYWORDS` tĩnh bằng Jev `Choice` phân loại vertical (`tech_ai`, `crypto_web3`, `politics`, v.v.).
- **AC:** Kiểm tra Brand Safety bằng `Noul("Is this trend related to tragic events, scams, or controversy?")` trước khi đề xuất comment.
- **AC:** Đánh giá cơ hội tương tác bằng `Score("thought-leader comment opportunity", ["avoid", "neutral", "good_hook", "must_post"])`.

### Story 42.7: jev-lead-icp-scoring — High-Throughput Batch Lead Qualification

- **AC:** Cung cấp endpoint batch qualification xử lý danh sách user profile (bio + recent tweets) qua Jev.
- **AC:** Trả về `buyerIntent` (Choice: `not_a_lead`, `problem_aware`, `solution_seeking`, `decision_maker`) và `leadScore` (Score: 0-3 ICP fit).
- **AC:** Đạt throughput xử lý batch lớn với chi phí tối ưu (~$0.024 / 1.000 users).

### Story 42.8: jev-cognitive-unfollow — Relationship Preservation & Audience Pruning

- **AC:** Trước khi unfollow một account không follow lại, gọi Jev `Choice` đánh giá mối quan hệ (`unfollow_dead`, `unfollow_spam`, `keep_high_value_influencer`, `keep_active_peer`).
- **AC:** Tự động giữ lại các account VIP/influencer trong ngành ngay cả khi họ không follow-back, ngăn chặn việc bot unfollow nhầm đối tác quan trọng.
- **AC:** Tự động loại bỏ các account đổi hướng sang spam/airdrop/nsfw.

### Story 42.9: jev-variant-judge — Jev-as-a-Judge Post Variant Selector & Cringe Filter

- **AC:** Khi sinh bài viết, cho LLM sinh 3 biến thể (variants), sau đó ném cả 3 vào Jev `Choice` để chọn biến thể tự nhiên nhất, ít sặc mùi AI corporate hype nhất.
- **AC:** Kèm `Noul` kiểm tra "cringe factor" (chứa sáo ngữ AI như 'game-changer', 'buckle up', 'delve') — nếu `cringeFactor > 0.3` thì reject hoặc yêu cầu re-roll.

---

## 9. Code Context Hiện Tại (cần biết trước khi implement)

### 9.1 LLMBrain (`src/agents/llmBrain.js`) — cấu trúc cần reuse

Tiered LLM client cho scoring, replying, content creation, strategy analysis.

- **Constructor config:** `provider` (`'openrouter'|'openai'|'ollama'`), `apiKey` (fallback `OPENROUTER_API_KEY`/`OPENAI_API_KEY` env), `baseUrl` (map từ `PROVIDER_URLS`: openrouter `https://openrouter.ai/api/v1/chat/completions`, openai, ollama localhost:11434), `models` — `{ fast: 'deepseek/deepseek-chat', mid: 'anthropic/claude-3.5-haiku', smart: 'anthropic/claude-sonnet-4' }`.
- **State nội bộ:** `_rateLimits: Map<model, {count, resetAt}>` (rate limit counters per model), `_usageToday` (cumulative usage per model: calls/inputTokens/outputTokens), `_usageDate`, `onUsage` callback (external usage recorder, e.g. database).
- **`_call(tier, messages, options)`** — core method, pattern để jevBrain mirror:
  1. `_checkRateLimit(model)`.
  2. Build body `{model, messages, temperature ?? 0.7, max_tokens ?? 1024}`.
  3. Loop **3 attempts**: headers `Content-Type` + `Authorization: Bearer` (+ openrouter extras `HTTP-Referer: https://xactions.app`, `X-Title: XActions Agent`); `fetch(baseUrl, POST)`.
  4. Retry khi `res.status === 429 || res.status >= 500` — backoff `Math.pow(2, attempt) * 1000 + Math.random() * 1000` ms.
  5. Non-ok khác → throw `LLM API error ${res.status}`.
  6. Parse `data.choices[0].message.content`, tokens từ `data.usage.prompt_tokens/completion_tokens`.
  7. `_recordUsage(model, in, out)` + `_bumpRateLimit(model)`, trả `{ text, inputTokens, outputTokens }`.
  8. Exception → backoff rồi retry; hết 3 attempts → `throw lastError`.
- **`scoreRelevance(text, keywords)`** — method hiện tại mà Story 42.2 cắm Jev thay thế: gọi LLM tier `fast`, sinh text rồi parse số — test cho thấy "return 50 on JSON parse error", "return 50 on fetch error", "clamp out-of-range scores to 50" — chính là pain "(2) không tin cậy: catch → return default".
- **`generateReply(tweet, personaJSON)`** — sinh prose, **KHÔNG cắm Jev** (Jev không generate).

**Lưu ý design:** jevBrain là module riêng `src/agents/jevBrain.js` — KHÔNG phải method thêm vào LLMBrain; nhưng reuse *shell* retry/rate-limit/usage pattern của LLMBrain. Fallback path gọi `LLMBrain.scoreRelevance`/judgment methods khi degrade.

### 9.2 thoughtLeaderAgent (`src/agents/thoughtLeaderAgent.js`) — decision heuristics hiện tại cần thay

`ThoughtLeaderAgent._searchAndEngage(query, tab)` (dòng ~225–289) — flow hiện tại:

1. Chọn query từ `config.niche.searchTerms` (hoặc `'AI'`), `browser.searchFor(query, tab)`, scroll 2–4 lần để load content.
2. `browser.extractTweets()` → loop từng tweet: skip ads, skip duplicate (`db.isDuplicate('like'|'comment', tweet.id)`).
3. **`const score = await this.llm.scoreRelevance(tweet.text, keywords);`** — 1 LLM call sinh text per tweet, chỉ để ra số.
4. **Ngưỡng cứng hiện tại (nơi Story 42.2 thay bằng Jev Choice + per-action confidence):**
   - `if (score > 60 && this._canDo('like'))` → `browser.likeTweet(tweet.id)`, `db.logAction('like', ...)`.
   - `if (score > 80 && this._canDo('comment') && Math.random() < 0.4)` → `llm.generateReply(...)` → `persona.validateContent(reply)` → `browser.replyToTweet(...)`.
5. `_browseHomeFeed()` dùng cùng pattern: `score > 50` → like; `score > 85 && Math.random() < 0.3` → bookmark.

Các helpers liên quan: `_canDo(action)` (limit check), `db.logAction`, `browser.antiDetection.simulateReading` (humanize), `rand()` cho delays. Thay đổi target: thay "score + ngưỡng cứng + coin-flip" bằng **một Jev call với questions `{action: Choice}`, dùng `action.choice` + `action.confidence` đối chiếu per-action threshold** (like≥0.6, reply≥0.85 — load từ config), rồi chỉ khi muốn reply mới gọi LLMBrain `generateReply` (prose path), sau đó **safety Noul trước khi write**.

### 9.3 Corpus format (`scripts/jev-verify/corpus.json`)

```json
{
  "_note": "Corpus mở rộng ~40 tweet — Việt/English/mixed/slang/link/mention/hashtag/ngắn/sarcasm/edge-case. Ground truth do người gán.",
  "niche": "ai-tools-vietnam",
  "nicheKeywords": ["ai", "llm", "automation", "devtools", "x actions", "claude", "gpt", "build", "ship", "agent"],
  "items": [
    {"id":"t01","lang":"vi","text":"...","author":"builder_vn","truth":{"relevant":1,"spam":0,"replyWorthy":1}},
    ...
  ]
}
```

40 items với `truth.relevant`/`truth.spam`/`truth.replyWorthy` ground truth. Story 42.3 yêu cầu corpus ≥50.

### 9.4 Verify harness (`scripts/jev-verify/verify.mjs`) — nền cho Story 42.3

- Chạy: `TYPESAFE_API_KEY=... node scripts/jev-verify/verify.mjs [--mock]` — `--mock` in request shape không gọi API.
- `buildQuestions(keywords)` trả đúng question set sẽ dùng trong `jevBrain.js` (relevance Score 4 levels, action Choice 5 options, isSpam/replyWorthy Noul).
- `callJev(item, questions)`: state `{tweet, author, nicheKeywords}`, POST systemOne, error → throw `Jev ${res.status}`.
- `evaluate(item, answers)`: `predRelevant = relScore >= 2`, `predSpam = spam >= 0.6`, so với `truth` → per-item hit.
- Tổng hợp: relevance accuracy %, spam accuracy %, accuracy by lang, tokens in/out, wall time, est. input cost `(in/1e9) * 42`.
- Story 42.3: nâng thành CI regression — corpus ≥50, floor vi≥85%/spam≥95%, drift alert.

---

## 10. Implementation Order (từ forge)

1. `src/agents/jevBrain.js` — REST client + retry + confidence gate helper.
2. `scoreRelevance` + action router + safety Noul.
3. `checkPersonaConsistency`.
4. `xspace DecisionEngine`.
5. `xeepy` batch (spam/targeting).

Sau đó các Expanded Decision Surfaces (42.4 → 42.9) theo thứ tự epics.md. Story 42.3 (CI regression guard) nên hạ trước khi adoption mở rộng — nó là safety net cho mọi surface sau.

---

## 11. Quick Reference — Constants & Env

| Item | Giá trị |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| Auth | `Authorization: Bearer ${TYPESAFE_API_KEY}` |
| Model | `jev-latest` |
| Degrade timeout | >5s |
| Retry shell | 3 attempts, `2^attempt * 1000 + jitter` ms (mirror LLMBrain `_call`) |
| Budget env | `JEV_DAILY_BUDGET_USD` |
| Budget bucket key | `jev:*` qua `DistributedTokenBucket` |
| Budget error code | `BUDGET_CEILING_REACHED` (soft degrade) |
| Cost verified | ~$0.024/1000 tweets; ~$42/B input tokens; ~300ms/call |
| Accuracy verified | relevance 85% · spam 98% · vi 92% · mixed 100% · en 79% |
| Suggested thresholds (verified baseline, phải config-able) | like≥0.6 · reply≥0.85 · relevance conf≥0.7 · persona noul≥0.7 · safety noul≥0.8 · pageStatus conf≥0.8 · samePerson score≥2 & conf≥0.85 · cringe>0.3 reject |
| Bot challenge error | `BotChallengeError` (XACT_5030) + `AdaptiveRateGovernor.hibernateAccount()` |
| Related error codes | `XACT_4xxx` caller, `XACT_5xxx` system (PlatformError envelope, AD-11) |
