# Forged Idea — Jev (TypeSafe) × XActions

## Quyết định khóa
- **Jev = Decision Engine riêng** (`src/agents/jevBrain.js`), KHÔNG phải LLM provider thứ 4 trong `llmBrain`. `systemOne` không phải `chat/completions` — "drop-in" là ảo giác.
- **Phân vai**: Jev = não quyết định (typed judgment + confidence). LLM = miệng viết (chỉ prose).
- Luồng: `state + questions → confidence gate (per-action, user-tunable) → act | queue-review | skip → nếu cần prose → LLMBrain`.
- Cơ chế chạm pain (ii) X-flag-vì-hành-vi: Jev là **volume reducer** — chỉ act khi confidence cao → ít action ngu → pattern ít bot-like. Chỉ đúng nếu dùng để *làm ít đi*, không phải làm nhiều hơn.

## Mapping function → primitive → state → threshold
| Chỗ | Primitive | State | Threshold |
|---|---|---|---|
| `llmBrain.scoreRelevance` | `Score` | `{tweet, niche}` | score≥"relevant" + conf≥0.7 |
| action router `thoughtLeaderAgent` (thay `>60/>80/rand<0.4`) | `Choice` | `{tweet, author, niche}` | per-action conf: like≥0.6, reply≥0.85 |
| `checkPersonaConsistency` | `Noul`+`Score` | `{text, persona}` | noul≥0.7 on-persona |
| `xspace DecisionEngine` | `Choice` | `{transcription, topic}` | respond/listen/backchannel + conf |
| `xeepy spam_detector/smart_targeting` | `Score`/`Choice` batch | `{profile, followers}` | batch — chỗ speed đếm được |
| Safety gate trước mỗi write | `Noul` | `{draft, context}` | noul≥0.8 safe-to-send |

## Mục tiêu đã map
- **Chi phí**: ✅ thật — mọi judgment đang gọi LLM (sinh text rồi `parseInt` vứt) → Jev rẻ ~200–400×, 1 call nhiều question song song.
- **Chất lượng**: ✅ thật — typed output + calibrated confidence thay `parseInt(regex)` và `JSON.parse` catch→default. Biết "không chắc" → escalate.
- **Speed**: ⚠️ có điều kiện — realtime loop bị X rate-limit đè (model speed vô nghĩa); chỉ đếm được ở batch (audit/score hàng loạt).

## Đã bác
- Jev-as-LLM-provider drop-in (sai API shape).
- Jev chữa X-flag trực tiếp (nó judge text, không đọc rate-limit/shadowban).
- Cắm vào `generateReply`/`generateContent`/`analyzeStrategy` (Jev không sinh prose).

## Crack còn sót — phải verify trước khi build
- Jev **text-only + English-primary** → tweet Việt/slang/media accuracy thấp. Test trên corpus thật.
- **Noul không có confidence** → yes/no tự threshold trên `noul` value.
- "Zero hallucination / 445× rẻ" là marketing claim → benchmark trên data thật, không tin docs.
- Vendor early-access, paid, single-provider → giữ LLM fallback path.
- REST thẳng bằng `fetch` (reuse retry/rate-limit của `LLMBrain`), né `@typesafe-ai/sdk` dep. Node engine đã là `>=20.18.1` → không blocking.

## Implementation order
1. `src/agents/jevBrain.js` — REST client + retry + confidence gate helper
2. `scoreRelevance` + action router + safety Noul
3. `checkPersonaConsistency`
4. `xspace DecisionEngine`
5. `xeepy` batch (spam/targeting)

---

## VERIFY RESULT (thật, 40-item corpus — đã chạy API)

**Endpoint:** `POST https://api.typesafe.ai/v1/systemone` · `Bearer TYPESAFE_API_KEY` · model `jev-latest`. Harness: `scripts/jev-verify/verify.mjs`, corpus `scripts/jev-verify/corpus.json`.

| Metric | Kết quả |
|---|---|
| Relevance accuracy | 85% |
| Spam accuracy | **98%** |
| vi / mixed / en | 92% / 100% / 79% |
| Cost | run10=$0.00024 · run40=$0.00097 → **≈ $0.024/1000 tweet** (1M ≈ $24) |
| Latency | ~300ms/call (4 question mỗi call) |

**Crack đã giải:** #1 Việt/slang — Jev đọc tốt (92–100%). #2 cost/speed — rẻ+nhanh thật ở batch. #3 fallback — khóa design (giữ LLMBrain).

**Insight:** `action` (Choice) đáng tin hơn `relevance` (Score trần) — Jev route đúng action kể cả khi score thấp. → `jevBrain` ưu tiên **Choice router**, Score làm phụ.

**Crack còn lại:** self-promo bị nhận spam (false-positive) → nới `isSpam` criteria (tách "self-promo" khỏi "scam/airdrop"). Corpus nhỏ — test định kỳ trên data production.
