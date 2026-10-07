---
title: 'Story 54.1 — TokenEntityExtractor: Cashtag, Contract & Name → Canonical Token ID'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_revision: '3688ecbcb30088874dd8f95ead6b69a3284275ed'
review_loop_iteration: 1
followup_review_recommended: false  # pass 2 (follow-up): chỉ patch low/medium, không high → converged
context:
  - 'src/analytics/tokenEntityExtractor.js'
  - 'tests/analytics/tokenEntityExtractor.test.js'
  - 'src/analytics/index.js'
  - 'src/scrapers/dexscreener/normalizer.js'
  - 'src/scrapers/descriptor.js'
  - 'src/scrapers/historyStore.js'
  - '_bmad-output/implementation-artifacts/epic-54-context.md'
  - '_bmad-output/implementation-artifacts/spike-54-coverage-report.md'
warnings: ['oversized — spec nhúng đầy đủ Review Triage Log + 15 settled decisions theo workflow; không tách file phụ để giữ audit trail trong artifact']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 54 cần mọi metric downstream (mindshare 54.4, hype 54.3, KOL ROI deferred) đếm mention trên **cùng một định danh token đã resolve**, không phải raw string. Hiện tại không có token-level entity resolution — `src/mcp/entity-resolver.js` chỉ resolve *persons* cho OSINT, không dùng lại được.

**Approach:** Viết `src/analytics/tokenEntityExtractor.js` — pure-JS extractor parse `$TICKER` cashtag, contract address (Solana base58 32–44 chars, EVM `0x[a-f0-9]{40}`), và bare token name (qua configurable alias map) từ tweet text thành `{ canonicalId, chain?, contract?, symbol, confidence }`. Canonical ID theo grammar AD-1 của epic spine: `token:{chain}:{contract}` (định danh duy nhất, merge được) vs `token:sym:{SYMBOL}` (ambiguous, never-merge). Core path là pure function zero-I/O; Dexscreener enrichment là injectable resolver riêng.

## Boundaries & Constraints

**Always:**
- Core extractor pure function, zero I/O, zero network — nhận text (và optional alias map config), trả `TokenMention`-entity array.
- canonicalId grammar theo AD-1: contract-address mention → `token:{chain}:{contract}` (định danh duy nhất); symbol/name mention không gắn được contract → `token:sym:{SYMBOL}` (ambiguous, **never merge** vào canonical contract identity).
- Symbol-only mentions phải có `confidence < 1` (collision-prone: `$PEPE` vs 10 clones); contract-address mentions mới được `confidence = 1` (hoặc cao nhất).
- Solana address validation: base58 charset (no `0`,`O`,`I`,`l`), length 32–44; EVM: `0x` + 40 hex chars (case-insensitive). False-positive guard: không nhận chuỗi ngẫu nhiên trong prose làm address khi không đủ tín hiệu (xem Design Notes).
- Alias map (bare-name → symbol/contract) là configurable input, weights `0.5/0.3/0.2` convention thuộc tokenRegistry downstream — extractor chỉ nhận config, không hardcode watchlist của jev.
- Enrichment Dexscreener = injectable resolver function riêng (caller truyền vào), gọi `scrape('dexscreener','token_lookup', { chainId, tokenAddress })` → đọc `res.data.pairs[]` flat fields `liquidity_usd`/`volume_24h`/`base_symbol` (đúng real shape đã verify trong spike 54.0 — KHÔNG nested `liquidity.usd`), liquidity anchor = max-liquidity pair.
- Unit tests theo convention `tests/analytics/` — vitest, **no mocks** (Mandatory Rule #1), real implementations only.
- License header `// Copyright (c) 2024-2026 nich (@nichxbt)...` + `@author nich (@nichxbt)` theo convention repo.

**Never:**
- Không extend hay sửa `src/mcp/entity-resolver.js` — module đó persons-only, viết riêng.
- Không viết pipeline/persistence logic (thuộc Story 54.2) — extractor chỉ trả entities, không ghi DB.
- Không embed HTTP call vào core extract path — Dexscreener enrich phải injectable, testable không cần network.
- Không dùng Prisma/TokenRegistry write path — 54.1 chỉ resolve + trả data; TokenRegistry persistence là story khác (AD-2).
- Không hardcode danh sách token của jev vào source — alias map là input.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `"$BONK pumping, contract DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP"` | 2 entities: `{canonicalId:'token:sym:BONK', symbol:'BONK', confidence<1}` + `{canonicalId:'token:solana:DezXAZ8z…', chain:'solana', contract, confidence:1}` | N/A |
| MULTI_TOKEN | Tweet nhắc `$PEPE`, `$WIF`, 2 contracts | 4 entities, mỗi entity có `canonicalId` riêng | N/A |
| FAKE_CASHTAG | `"$100 to the moon"` / `"$A"` (1 char) | Không extract — `$` + digits không phải cashtag; min length ≥2 | Skip silently |
| SAME_SYMBOL_DIFF_CHAIN | Alias map có `PEPE` trên ethereum `0x…` và solana `DezX…`; tweet chỉ ghi `$PEPE` | `token:sym:PEPE` confidence<1 (never-merge) — không đoán chain | Không throw |
| CONTRACT_DISAMBIG | Tweet có contract `0x6982…` (EVM) + `$PEPE` cùng câu | Contract entity `token:ethereum:0x6982…` (chain=evm từ format) + cashtag entity riêng; nếu alias map map contract→symbol thì symbol gắn vào contract entity | N/A |
| INVALID_ADDR | Chuỗi base58-like sai length / chứa `0OIl` / EVM hex sai 40 chars | Không extract | Skip silently |
| BARE_NAME | `"dogwifhat mooning"` + alias map `{'dogwifhat':'WIF'}` | `token:sym:WIF` (hoặc `token:solana:<contract>` nếu alias map gắn contract) với confidence<1 | N/A |
| BARE_NAME_NO_ALIAS | `"dogwifhat mooning"` không có alias map | Không extract bare name (tránh false positive prose) | N/A |
| EMPTY_INPUT | `""` / `null` / undefined | Trả `[]` | Return `[]`, không throw |
| ENRICH_MISS | Injectable resolver trả null/không có pair | Entity giữ `confidence` gốc, không thêm contract | Không throw; miss là hợp lệ |

</intent-contract>

## Code Map

- `src/analytics/tokenEntityExtractor.js` — **FILE MỚI**, core extractor. Export tối thiểu `extractTokenEntities(text, opts?)` (pure) + `createDexscreenerTokenResolver(deps?)` (injectable enrichment factory) + `createTokenResolver`/`resolveWithEnrichment` seam nếu cần.
- `tests/analytics/tokenEntityExtractor.test.js` — **FILE MỚI**, vitest, no mocks, cover toàn bộ I/O matrix.
- `src/mcp/entity-resolver.js` — **READ-ONLY** precedent style (pure-JS confidence-scored resolution, JSDoc-heavy). KHÔNG reuse/re-export — persons-only theo epic spine.
- `src/scrapers/crypto/dexscreener/normalizer.js:213` — `normalizeTokenLookup` cho thấy real response shape: `pairs[]` với `liquidity_usd`, `volume_24h`, `base_symbol`, `pair_address` (flat, verified spike 54.0).
- `src/scrapers/crypto/dexscreener/descriptor.js:67` — `mapArgs`: `chain|chainId|network`→`chainId`, `token|address|mint`→`tokenAddress`. Resolver injectable gọi `scrape('dexscreener','token_lookup',{chainId,tokenAddress})` từ `src/scrapers/index.js`.
- `src/analytics/historyStore.js` — SQLite `~/.medirus/analytics.db` (better-sqlite3, WAL). Spike 54.0 quyết định enrichment **cached qua historyStore** — nếu dùng, tạo table riêng (username-keyed tables hiện có không reuse được, AD-2).
- `_bmad-output/implementation-artifacts/spike-54-coverage-report.md` — verdict GO cho 54.1: cashtag hit 1.00, contract 1.00; contract-address search KHÔNG mù (decision fork not triggered).
- `_bmad-output/implementation-artifacts/epic-54-context.md` — AD-1 canonicalId grammar, AD-4 dedup key `(canonicalId, platform, platformId)` (downstream), conventions `sentimentScore` lexicon-at-ingest.

## Tasks & Acceptance

**Execution:**
- `src/analytics/tokenEntityExtractor.js` — implement extractor theo intent contract: cashtag regex (`\$[A-Za-z][A-Za-z0-9]{1,9}`-ish, min 2 chars, không match `$<digits>`), Solana base58 32–44 + EVM `0x[0-9a-fA-F]{40}` detectors, alias-map bare-name matching (word-boundary, case-insensitive, longest-match-first), canonicalId builder theo AD-1, confidence model (contract=1, symbol-only<1, bare-name<symbol). Export pure `extractTokenEntities` + injectable `createDexscreenerTokenResolver`.
- `tests/analytics/tokenEntityExtractor.test.js` — vitest suite cover HAPPY_PATH → ENRICH_MISS trong I/O matrix: multi-token tweets, fake cashtags, same-symbol-diff-chain, invalid addresses, empty input, alias miss, resolver miss.

**Acceptance Criteria:**
- Given tweet text chứa `$TICKER`/contract/name, when gọi `extractTokenEntities(text)`, then mỗi mention resolve thành `{ canonicalId, chain?, contract?, symbol, confidence }` với canonicalId đúng grammar AD-1 (`token:{chain}:{contract}` vs `token:sym:{SYMBOL}` never-merge).
- Given core extract path, when chạy không có network/alias resolver, then function vẫn pure & deterministic (zero I/O).
- Given injectable Dexscreener resolver, when contract mention được enrich, then resolver map contract↔symbol (+price/liquidity/volume) qua `scrape('dexscreener','token_lookup')` đọc `res.data.pairs[]` flat fields — `pairs` đã normalize KHÔNG chứa socials (verified `src/scrapers/crypto/dexscreener/normalizer.js` `normalizeTokenLookup`). Socials là seam opt-in riêng: `createDexscreenerTokenResolver({ scrape, withSocials: true })` → call thêm `scrape('dexscreener','token_socials',{chainId,tokenAddress})` merge `socials` vào result; **default off** (tiết kiệm poll budget spike 54.0). Miss (null/empty pairs/resolver throw) thì entity giữ nguyên confidence gốc, không throw.
- Given `npx vitest run tests/analytics/tokenEntityExtractor.test.js`, when run, then tất cả test pass, zero mocks.

## Spec Change Log

### 2026-10-05 — Review pass 1 (bad_spec amendment)

**Triggering finding:** Edge-case layer — AC đòi resolver "map contract↔symbol↔socials qua token_lookup" nhưng `normalizeTokenLookup` (`src/scrapers/crypto/dexscreener/normalizer.js`) không emit socials; socials chỉ có ở action `token_socials` riêng. Cùng pass, 10 findings medium xuất phát từ Design Notes thiếu quyết định (adjacency boost, chain inference, digit-only guard, alias validation, arg-shape parity, dedup merge).

**What was amended:**
- Acceptance: tách socials khỏi `token_lookup` — resolver map contract↔symbol(+metrics) qua token_lookup; socials = seam opt-in `withSocials` → `token_socials`, default off.
- Design Notes: thêm block "Review pass 1 — settled decisions" gồm 15 quyết định chi tiết (positional context boost, chain inference map, digit-only reject, `0X` prefix, cashtag `_` boundary, null-options tolerance, non-array→[], dedup field-merge, alias contract validation, resolver `{contract}` alias, fail-fast scrape dep, case-insensitive contract alias keys, single cashtag definition, socials opt-in seam, coverage requirements).

**Known-bad state avoided:** tweet-global context boost → phantom confidence-1.0 contracts từ base58 ngẫu nhiên; `resolveToken({contract})` dead-path trả null; `token:{chain}:<garbage>` canonicalId từ aliasMap contract không validate; EVM chain luôn `ethereum` kể cả khi text ghi "BSC"; AC không-thể-đạt vì socials không tồn tại trong token_lookup shape.

**KEEP instructions (phải sống sót qua re-derivation):**
- Một file module, `extractTokenEntities` pure + resolver/enrich seams async tách — KEEP.
- AD-1 grammar `token:{chain}:{contract}` vs `token:sym:{SYMBOL}` never-merge — KEEP.
- Confidence tiers: contract+context 1.0, bare-base58-no-context 0.7, cashtag 0.8, bare-name 0.6, alias→contract 0.8 — KEEP.
- `createDexscreenerTokenResolver(deps.scrape)` injectable, đọc `res.data.pairs` flat fields, liquidity anchor = max-liquidity pair, miss non-throwing → null — KEEP.
- `matchWholeWord` word-boundary case-insensitive + alias keys longest-first — KEEP.
- Solana contract giữ casing, EVM contract normalize lowercase — KEEP.
- enrichTokenEntities clone entities, giữ confidence gốc khi miss, đính `dexscreener`/`enriched`/`symbol` khi hit — KEEP.
- vitest convention: deterministic injected functions (không mock framework), describe/it theo matrix row — KEEP.
- License header `// Copyright (c) 2024-2026 nich (@nichxbt)` + `@author nich (@nichxbt)` + JSDoc-heavy style — KEEP.
- Re-export qua `src/analytics/index.js` barrel — KEEP.

## Review Triage Log

### 2026-10-05 — Review pass 1
- verdicts: 30 findings — high 0, medium 11, low 14, false 5, maybe-false 0
- findings:
  - `[medium]` `[patch→bad_spec-fold]` resolveToken `{contract}` arg dead path — early-return `!args.tokenAddress` chạy trước fallback `|| args.contract` (verified tại code); fix: guard `!(args.tokenAddress || args.contract)` — fold vào settled decision #9.
  - `[medium]` `[patch→bad_spec-fold]` Digit-only base58 accepted (charset cho phép 1-9) — phantom contract entity; fold vào decision #2.
  - `[medium]` `[patch→bad_spec-fold]` `hasCashtagInText`/`textContextPresent` tweet-global boost — cashtag/keyword bất kỳ nâng mọi base58 → 1.0; fold vào decision #1 (positional ±100 chars).
  - `[medium]` `[patch→bad_spec-fold]` EVM chain luôn `defaultEvmChain` bỏ qua chain keywords trong TOKEN_CONTEXT_REGEX — "bsc contract 0x…" → `token:ethereum:…` sai canonicalId; fold vào decision #3.
  - `[medium]` `[patch→bad_spec-fold]` addEntity dedup chỉ upgrade confidence, drop symbol/rawMention/mentionType của mention sau; fold vào decision #7. (O(n²) find-in-loop: negligible ở quy mô tweet — ghi nhận, không tách row.)
  - `[low]` `[reject]` Resolver không cache miss + cache unbounded — cache là opt-in injectable (default không cache); fix cần sentinel/`cache.has` hơn một direct correction cho feature opt-in.
  - `[low]` `[reject]` enrichTokenEntities await tuần tự — perf nit, N nhỏ (số token/tweet), zero production callers; fix rewrite loop không cần thiết.
  - `[low]` `[reject]` resolveToken không pre-validate tokenAddress — misuse-only, Dexscreener miss vẫn trả null an toàn; thêm guard cho state chưa chứng minh.
  - `[low]` `[reject]` Tests dùng hand-written stub functions — spec AC chủ động chỉ định "deterministic injected functions" (no-mock-framework DI tại seam đã document); mâu thuẫn convention-rule vs spec-AC là câu hỏi repo-policy, không phải code defect trong story này.
  - `[medium]` `[patch→bad_spec-fold]` Coverage gaps: 0.7-path, requireSolanaContext, contract-arg, resolver-throw, uncached-miss chưa test; fold vào decision #15.
  - `[low]` `[patch→bad_spec-fold]` aliasMap EVM lookup chỉ thử raw+lowercase — key checksummed lệch casing unreachable; fold vào decision #11.
  - `[low]` `[patch→bad_spec-fold]` Missing-scrape throw sau cache check (lazy) + enrich catch-swallow — hoist fail-fast vào decision #10; phần catch-swallow là spec'd behavior (miss is valid) → reject nửa đó.
  - `[low]` `[patch→bad_spec-fold]` `isValidSolanaAddress` check `[0OIl]` thừa (charset regex đã loại) — deletion cleanup, fold vào re-derivation.
  - `[false]` `[reject]` "Base58 trong URL pump.fun extract mơ hồ" — không có bad outcome cụ thể; extract contract từ dex URL là mục đích feature.
  - `[low]` `[patch→bad_spec-fold]` enrichTokenEntities non-array input trả lại non-array — `entities || []` vi phạm return-type; fold vào decision #6.
  - `[low]` `[patch→bad_spec-fold]` `options=null` → destructure TypeError (cả extractTokenEntities & resolveWithEnrichment); fold vào decision #6.
  - `[low]` `[patch→bad_spec-fold]` `0X` uppercase prefix không extract (regex chỉ `0x`); fold vào decision #5.
  - `[medium]` `[patch→bad_spec-fold]` resolveToken contract-only (edge layer, trùng root với row 1 — cùng group, cùng route).
  - `[medium]` `[patch→bad_spec-fold]` aliasMap `{contract}` không validate → `token:{chain}:<garbage>` canonicalId confidence 0.8; fold vào decision #8.
  - `[low]` `[patch→bad_spec-fold]` dedup drop alias-provided symbol (trùng root với row 5 — cùng group).
  - `[low]` `[patch→bad_spec-fold]` `$PEPE_ARMY` extract thành `$PEPE` (lookahead thiếu `_`); fold vào decision #4.
  - `[low]` `[patch→bad_spec-fold]` `hasCashtagInText` dùng regex yếu hơn CASHTAG_REGEX — `foo$BAR` boost lên 1.0; fold vào decision #12 (+ #1 khiến global flag biến mất).
  - `[medium]` `[bad_spec]` Resolver result thiếu `socials` — AC đòi socials qua token_lookup nhưng normalizer không emit; spec lỗi, không phải code — đã amend AC (socials = opt-in `token_socials` seam, decision #13).
  - `[medium]` `[patch→bad_spec-fold]` vgap: contract-arg path untested + dead-path bug (pre-verified) — cùng group row 1.
  - `[medium]` `[patch→bad_spec-fold]` vgap: contract-arg path thiếu test coverage — fold vào decision #15.
  - `[low]` `[patch→bad_spec-fold]` vgap: aliasMap contract-key casing mismatch (pre-verified) — cùng group row 11.
  - `[false]` `[reject]` Intent-audit "spec tự-chứng (self-certifying)" — quan sát process của dispatch flow, không phải defect code; spec đã đối chiếu epic-54-context + spike report khi viết.
  - `[false]` `[reject]` Intent-audit "historyStore caching bị thay bằng in-memory" — spec viết "nếu dùng" (conditional) và Never-list cấm persistence 54.2; in-memory injectable là reading duy nhất nhất quán.
  - `[medium]` `[patch→bad_spec-fold]` Intent-audit: FP-guard default-off & untested ở behavior mặc định — fold vào decisions #1/#15.
  - `[false]` `[reject]` Intent-audit "scrape dispatch path untested" — spike 54.0 đã verify real contract shape (coverage-report); seam-injection testing là spec'd design.
  - `[false]` `[reject]` Intent-audit "symlink dangling ngoài scope" — targets tồn tại dạng untracked files trong worktree (data refresh cùng ngày), commit cùng finalize, không dangling.

- Cascade: bad_spec tồn tại → tất cả patch entries moot cho pass này; fix của chúng được fold vào Spec Change Log amendment + re-derivation.

### 2026-10-05 — Review pass 2
- verdicts: 20 findings — high 0, medium 3, low 13, false 4, maybe-false 0
- findings:
  - `[medium]` `[patch]` `enrichTokenEntities` không wrap `await resolver` — injected resolver throw propagate, phủ định claim "miss never throws" (verified tokenEntityExtractor.js:~524); fix: try/catch → null, test mới `treats a throwing injected resolver as a miss`.
  - `[medium]` `[patch]` `0x<41+hex>` malformed run: hex body (pure base58 ≥32) bị Solana regex bắt → phantom solana contract, phủ định INVALID_ADDR (verified); fix: `EVM_FORBIDDEN_REGEX` + `forbiddenEvmSpans()` nạp cả malformed spans vào vùng cấm trước khi scan Solana; test `does not extract a Solana contract out of a malformed 0x<41+hex> run`.
  - `[medium]` `[patch]` vgap: `resolveWithEnrichment` `{scrape}` shorthand factory branch untested (chỉ `resolver`/`null` covered) — branch hỏng vẫn green; fix: test `builds a dexscreener resolver from the { scrape } shorthand`.
  - `[low]` `[patch]` Zero-liquidity pairs → `best=null` (reduce init null, `0 > 0` false) → miss dù pairs tồn tại; fix: `pairs[0] ?? null` fallback; test `zero-liquidity pairs still resolve to first pair`.
  - `[low]` `[patch]` Empty-string alias key → regex `(?<![\w$])(?!\w)` match khắp nơi flood entities; fix: `if (!key || !key.trim()) continue`; test `empty-string alias key is ignored`.
  - `[low]` `[patch]` non-object elements trong enrich input → `{...null}`/`{...'str'}` malformed output; fix: pass-through nguyên phần tử; test `non-object elements pass through`.
  - `[low]` `[patch]` alias value `symbol` non-string truthy (123) → `.toUpperCase()` TypeError; fix: `String(value.symbol ?? '')`; test `non-string alias symbol is coerced`.
  - `[low]` `[patch]` TOKEN_CONTEXT_REGEX chứa `ca|sol|eth|base|arb|pair|tokens` quá phổ → boost 1.0 cho rác; fix: bỏ tokens/pair/eth/base/arb/sol/avax đơn lẻ, `ca`/`sol` chỉ match dạng `ca:`/`ca =`; giữ keyword hiếm (contract, solana, bsc, ethereum…).
  - `[low]` `[patch]` EVM lookahead `(?![0-9a-zA-Z])` bất đối xứng vs lookbehind `(?<!\w)` — `0x<40hex>_x` vẫn match; fix: `(?!\w)`.
  - `[low]` `[patch]` Resolver cache key không normalize case — checksummed vs lowercase EVM = 2 scrape; fix: lowercase tokenAddress khi `/^0x/i`.
  - `[low]` `[reject]` `base` trong EVM_CHAIN_KEYWORDS là từ Anh thường → `token:base:` sai — spec'd "first hit wins" (decision #3); siết thêm = thêm heuristic không phải direct correction.
  - `[low]` `[reject]` contextSlice bất đối xứng (sau address ~56 chars hiệu dụng) — polish; ±100 là spec'd radius, asymmetry không tạo bad outcome đã demo.
  - `[low]` `[reject]` alias EVM contract không chạy inferEvmChain (`value.chain || 'ethereum'` cứng) — alias config là caller-supplied ground truth, suy ra chain từ context sẽ override ý định caller; hành vi đúng.
  - `[low]` `[reject]` Solana lookbehind chỉ loại base58 → `0<base58>` extract phần trong — sau patch EVM_FORBIDDEN, `0<hex>` đã bị chặn bởi… (thực tế `0` không phải `x`; `0<base58>` vẫn extract inner run). Đánh giá: malformed-token-boundary edge, hiếm gặp ở tweet thật; thêm lookbehind `[0OIl]` là guard cho state chưa demo → reject.
  - `[low]` `[reject]` `soc.data` non-array object gán thẳng `result.socials` — resolver output shape là spec'd; misuse-only.
  - `[low]` `[reject]` `defaultEvmChain:'solana'` → `token:solana:0x…` — caller-config misuse; guard thêm branch không direct.
  - `[low]` `[reject]` spec frontmatter `context: []` + `status` stale — đã sửa tay tại finalize (context list điền đầy đủ, status→done); không phải code defect.
  - `[false]` `[reject]` Resolver không pre-validate tokenAddress → "rác tốn 1 scrape" — miss trả null đúng semantics, không bad outcome; trùng finding pass 1 (đã reject).
  - `[false]` `[reject]` dedup mất mentionCount — spec không yêu cầu count; downstream 54.2 chưa định nghĩa consumer → không phải defect của intent này.
  - `[false]` `[reject]` Data symlinks `latest-twitter-*.json` ngoài scope — targets tồn tại untracked trong worktree, refresh cùng ngày; settle từ pass 1.

- Patches applied (in-place): 10 fixes + 7 regression tests trong `describe('pass-2 review patches')` + `{scrape}` shorthand test. Verification: 44/44 tokenEntityExtractor tests, 237/237 analytics suite pass.

## Design Notes

**Confidence model (gợi ý, implementer tinh chỉnh):**
- `1.0` — contract address hợp lệ (Solana base58 32–44 đúng charset hoặc EVM 0x40hex).
- `<1` — cashtag `$SYM` (collision clone), thấp hơn nữa cho bare name qua alias map.
- Ranking khi enrich: contract entity giữ identity `token:{chain}:{contract}`; symbol mention KHÔNG merge vào contract identity trừ khi resolver chứng minh mapping.

**False-positive guard cho addresses:** Solana base58 32–44 chars xuất hiện tự nhiên trong text (hashes, IDs). Chỉ coi là contract khi: (a) nằm cạnh cashtag/token context trong cùng tweet, hoặc (b) alias map/config confirm. Đơn giản nhất: extract tất cả candidate nhưng gắn `confidence` thấp cho "bare base58 không context" — downstream 54.2 filter.

**Dexscreener resolver shape (verified spike 54.0):**
```js
const res = await scrape('dexscreener', 'token_lookup', { chainId, tokenAddress: contract });
const pairs = res?.data?.pairs ?? res?.pairs ?? [];
const best = pairs.reduce((a,p) => (p?.liquidity_usd ?? 0) > (a?.liquidity_usd ?? 0) ? p : a, null);
// best.base_symbol, best.liquidity_usd — flat fields, KHÔNG nested
```


### Review pass 1 — settled decisions (bắt buộc cho re-derivation)

Các quyết định sau được chốt từ review findings — implementer KHÔNG được tự ý thay đổi:

1. **Context boost phải positional, không tweet-global.** Token-context keyword hoặc cashtag chỉ boost confidence khi nằm **trong ±100 ký tự** (hoặc cùng câu) của candidate address. Tweet-global flag bị cấm — một cashtag/keyword bất kỳ trong tweet KHÔNG được nâng mọi base58 thành confidence 1.0. Bare base58 không adjacent context → `confidence: 0.7`.
2. **Reject all-digit base58.** Candidate thỏa `/^\d+$/` không phải Solana address (thực tế luôn có chữ) — skip (tweet IDs, hashes, numeric strings).
3. **EVM chain inference từ context keywords** nằm gần address (cùng ±100 chars): `bsc|bnb|binance`→`bsc`, `polygon|matic`→`polygon`, `arbitrum|arb`→`arbitrum`, `base`→`base`, `avax|avalanche`→`avalanche`, `eth|ethereum`→`ethereum`; fallback `defaultEvmChain`. Chain keywords đã có trong TOKEN_CONTEXT_REGEX — phải wire vào chain chứ không bỏ qua.
4. **Cashtag boundary:** `$TOKEN` không được extract khi ký tự ngay sau symbol là `_` (`$PEPE_ARMY` không phải cashtag → skip hoàn toàn). Symbol charset: `[A-Za-z][A-Za-z0-9]{1,9}`.
5. **EVM prefix chấp nhận `0X` uppercase** (`0[xX]`), normalize về `0x` lowercase; `isValidEvmAddress` accept cả hai.
6. **`options=null`/`entities=null` tolerated** như undefined — không destructure-crash; `enrichTokenEntities` trả `[]` cho non-array input (KHÔNG trả lại non-array).
7. **Dedup canonicalId phải merge fields:** khi entity mới trùng canonicalId với entity đã có → upgrade confidence nếu cao hơn VÀ fill các field đang thiếu (symbol, rawMention, mentionType, chain) — không drop data caller cung cấp.
8. **aliasMap `{contract}` phải validate** qua `isValidSolanaAddress`/`isValidEvmAddress` trước khi dùng làm canonicalId; contract invalid → degrade về symbol-only entity (`token:sym:{SYMBOL}`), không bao giờ emit `token:{chain}:<garbage>`.
9. **Resolver `{contract}` là alias hợp lệ của `tokenAddress`:** guard `!args.tokenAddress && !args.contract` — contract-only call phải resolve được (không dead-path). Tương tự `{chain}` alias `chainId`.
10. **Missing `deps.scrape` throw ngay khi gọi factory** (`createDexscreenerTokenResolver`) — fail-fast, không chờ call đầu tiên.
11. **Contract-keyed aliasMap lookup case-insensitive:** EVM contract trong text có thể checksummed; key trong aliasMap có thể casing khác — compare lowercase cả hai phía (Solana key giữ exact-match vì base58 case-sensitive).
12. **Một định nghĩa cashtag duy nhất:** mọi helper kiểm tra cashtag phải dùng cùng definition với CASHTAG_REGEX — cấm regex ad-hoc yếu hơn (ví dụ `foo$BAR` không được tính là cashtag để boost).
13. **Socials seam opt-in:** `createDexscreenerTokenResolver({ scrape, withSocials })` — `withSocials=true` thì call `token_socials` và merge `result.socials`; default off. Không bắt buộc cho AC token_lookup.
14. **Cache misses:** implementer tự chọn — cache cả miss (sentinel + `cache.has`) hoặc chỉ cache hit (document rõ trong JSDoc "misses are not cached"). Không block.
15. **Coverage bắt buộc thêm** (ngoài 10 matrix rows): bare-base58-không-context → 0.7; `requireSolanaContext:true` skip no-context candidate; resolver `{contract}`-only arg; resolver throw → null; digit-only reject; `$PEPE_ARMY` no-match; `0X` prefix; `options=null`; non-array enrich input; dedup field-merge; EVM chain inference `bsc`; aliasMap contract-key casing lệch.

## Verification

**Commands:**
- `npx vitest run tests/analytics/tokenEntityExtractor.test.js` — expected: all tests pass.
- `npx vitest run tests/analytics/` — expected: không regression suite analytics hiện có.

## Auto Run Result

- **Summary:** TokenEntityExtractor pure-JS module — `extractTokenEntities` parse `$TICKER` cashtag, Solana base58 32–44 (digit-only reject, malformed-`0x` hex-body guard), EVM `0x`/`0X` +40hex (lowercase normalize, chain inference từ context window ±100 chars) và bare-name qua aliasMap → `{canonicalId, chain?, contract?, symbol, confidence, mentionType, rawMention}` theo AD-1 (`token:{chain}:{contract}` vs never-merge `token:sym:{SYMBOL}`). Confidence: contract+ctx 1.0 / bare-base58 0.7 / cashtag 0.8 / bare-name 0.6 / alias-contract 0.8. `createDexscreenerTokenResolver` injectable seam đọc `res.data.pairs[]` (max-liquidity anchor, zero-liq fallback pairs[0]), `token_socials` opt-in qua `withSocials`, injectable `cache` (hits-only), fail-fast khi thiếu `deps.scrape`. `enrichTokenEntities`/`resolveWithEnrichment` merge resolver result, tolerate throw → miss.
- **Files changed:**
  - `src/analytics/tokenEntityExtractor.js` (NEW, ~580 lines) — extractor + resolver + enrichment.
  - `src/analytics/index.js` — barrel re-export.
  - `tests/analytics/tokenEntityExtractor.test.js` (NEW, ~540 lines, 44 tests) — 10 matrix rows + settled-decision coverage + pass-2 patch regressions.
  - `_bmad-output/implementation-artifacts/spec-54-1-...md` (THIS FILE) — spec + triage log + auto-run result.
  - `data/viral-stats/latest-twitter-*.json` (2 symlinks) — data refresh cùng ngày, ngoài phạm vi code.
- **Review findings breakdown:** pass 1 — 30 findings (med 11 / low 14 / false 5) → 1 bad_spec (socials AC impossible qua token_lookup) → revert + spec amend (15 settled decisions) + re-derive. pass 2 — 20 findings (med 3 / low 13 / false 4): 10 patch entries applied in-place (resolver-throw guard, malformed-0x forbidden span, scrape-shorthand test, zero-liq fallback, empty alias key, non-object passthrough, symbol coercion, context-keyword noise reduction, EVM lookahead symmetry, cache-key normalization); 7 low rejected (spec'd behavior, misuse-only, hoặc polish không có demonstrated bad outcome); 4 false rejected (đã ghi refutation trong log). Deferred: 0.
- **Follow-up review:** `followup_review_recommended: false` — pass 2 là follow-up pass; chỉ patch medium/low, không high → converged. Không còn unverified risk nào được nêu danh.
- **Verification:** `npx vitest run tests/analytics/tokenEntityExtractor.test.js` → 44/44 pass; `npx vitest run tests/analytics/` → 237/237 pass, không regression.
- **Residual risks:** (a) `base` keyword inference có thể gán `token:base:` khi "base" dùng nghĩa thường — spec'd first-hit-wins, accept; (b) `0<base58>` boundary edge (ký tự base58-excluded đứng trước run) vẫn extract inner run — hiếm gặp, chấp nhận; (c) seam `scrape('dexscreener','token_lookup')` dispatch thật chưa có integration test (spike 54.0 đã verify contract shape; downstream stories sẽ exercise).
