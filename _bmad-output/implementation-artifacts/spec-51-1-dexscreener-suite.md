---
title: '51.1 DEX & Token Liquidity Intelligence Suite (/dexscreener)'
type: 'feature'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: c2897cfdc2bf79ec9442bd7bff8ff28c0fb12ee0
context:
  - '{project-root}/_bmad-output/specs/spec-fe-platform-suites/SPEC.md'
warnings: []
deferred:
  - summary: >-
      Badge "Pump.fun Origin" hiện cho mọi cặp có chain_id solana, kể cả token không
      xuất phát từ Pump.fun, nên link /pumpfun?mint= trả 404 với SOL, USDC hay cặp Raydium.
    evidence: |-
      Backend token_lookup (normalizeTokenLookup) không trả cờ nguồn gốc bonding-curve mà
      CAP-1 yêu cầu, nên frontend không phân biệt được token Pump.fun với token Solana khác.
      Cần bổ sung tín hiệu này ở backend rồi mới siết điều kiện badge.
    location: >-
      apps/web/app/dexscreener/page.tsx (biến isSolana trong sortedPairs.map)
    severity: medium
  - summary: >-
      Request lookup cũ có thể ghi đè kết quả mới khi người dùng tra cứu liên tiếp rất nhanh
      vì không có AbortController.
    evidence: |-
      scrape() nhận signal nhưng executeLookup không truyền. Chưa tái hiện được bằng trạng thái
      thực — cần reproduces với độ trễ mạng để xác nhận response về sau ghi đè response về trước.
    location: >-
      apps/web/app/dexscreener/page.tsx (executeLookup)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Trader Web3 phải gọi raw API qua `/gateway` để xem thanh khoản và giá token trên Dexscreener — `apps/web` chưa có giao diện chuyên biệt nào cho nền tảng này dù backend `dexscreener` (5 action, sync-capable) đã chạy ổn định.

**Approach:** Thêm trang `/dexscreener` gọi action `token_lookup` (theo chain + địa chỉ token) và `latest_boosted` (feed trending) qua BFF `POST /api/platform/dexscreener/scrape` ở `mode: 'sync'`, render lưới card cặp giao dịch với lọc chain, sắp xếp, badge nguồn gốc Pump.fun và các nút copy/link; thêm mục "Dexscreener" vào nhóm điều hướng **Intelligence**.

## Boundaries & Constraints

**Always:**
- Mọi request đi qua helper `api()` (`@/lib/api`) tới same-origin BFF — không `fetch()` trực tiếp, không gọi `api.dexscreener.com` từ browser.
- Dùng đúng tên action backend thật: `token_lookup` (cần `chainId` + `tokenAddress`) và `latest_boosted` (nhận `limit`). Không có action `search_pairs`/`token_pairs` tên riêng — `token_pairs` chỉ là alias của `token_lookup`.
- Đọc field snake_case đúng shape normalizer: `pairs[].{dex_id, pair_address, pair_url, base_symbol, base_name, price_usd, price_native, liquidity_usd, volume_24h, price_change_24h}`, `data.chain_id`, `data.token_address`.
- Ảnh token dùng `referrerPolicy="no-referrer"` và có icon coin fallback khi lỗi/thiếu.
- Empty state khi lỗi upstream (403/429/challenge) hiện thông điệp + nút "Retry" — không crash, không màn hình trắng.
- Trang là client component (`'use client'`), theo style Tailwind + lucide-react như `app/pumpfun/page.tsx`.

**Never:**
- Không sửa backend dexscreener (`src/scrapers/crypto/dexscreener/**`) — story này chỉ là frontend.
- Không dựng biểu đồ giá (chart) — CAP-1 mô tả "biểu đồ biến động giá đơn giản" nhưng dữ liệu backend chỉ có `price_change_24h` dạng số, không có chuỗi thời gian; hiện pill % thay thế.
- Không thêm action `search` theo symbol (backend không hỗ trợ) — ô tìm kiếm nhận mint/contract address, không nhận symbol ticker.
- Không đụng các suite khác của Epic 51 (`/youtube`, `/fediverse`, `/enterprise-vn`, `/jobs-vn`) — mỗi suite là một story riêng.
- Không hardcode URL backend; không thêm dependency mới.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lookup happy path | Nhập địa chỉ token hợp lệ + chọn chain, bấm Search | Gọi `token_lookup` với `{chainId, tokenAddress, mode:'sync'}`; render 1 card cho mỗi phần tử `data.pairs` với symbol, DEX badge, giá, pill % 24h (xanh dương tính / đỏ âm), volume, liquidity | Không lỗi |
| Trending feed | Mở trang lần đầu (chưa search) | Gọi `latest_boosted` với `{limit}` và render danh sách token đang boost (chain, mô tả, amount) | Không lỗi |
| Chain filter | Chọn badge chain (Solana/Base/Ethereum/BSC) khi đang xem trending | Danh sách boosted lọc client-side theo `chain_id` khớp badge | Không lỗi |
| Sort | Đổi sort (Volume/Liquidity/Price Change) trên kết quả lookup | Các card sắp xếp lại client-side theo field tương ứng, giảm dần | Không lỗi |
| Pump.fun origin | Cặp có `chain_id === 'solana'` | Card hiện badge "Pump.fun Origin" link tới `/pumpfun?mint=<token_address>` | Không lỗi |
| Copy address | Bấm "Copy Pair Address" | `pair_address` vào clipboard; nút hiện dấu check ~1.5s rồi trở lại | Nếu clipboard API lỗi: không crash, giữ nguyên nút |
| Empty result | `token_lookup` trả `pairs: []` | Empty state "Không tìm thấy cặp giao dịch" thay vì lưới rỗng | Không lỗi |
| Upstream error | Response scrape không ok hoặc `result` chứa lỗi (403/429/challenge) | Empty state có icon cảnh báo + thông điệp + nút "Retry" gọi lại request | Bắt lỗi, không throw ra UI |
| Ảnh lỗi | `icon`/ảnh token 404 hoặc thiếu | Fallback icon coin generic, không hiện ảnh vỡ | `onError` đổi sang fallback |

</intent-contract>

## Code Map

- `src/scrapers/crypto/dexscreener/descriptor.js:15-61` — action map thật: `token_lookup` (alias `token_pairs`, `pairs`, `pair_lookup`), `latest_boosted` (alias `trending`, `boosted`), `token_socials`, `token_legitimacy`, `latest_profiles`. Tất cả `syncCapableActions`. `mapArgs` (`:67-83`) gom `chain|chainId|network → chainId`, `token|tokenAddress|address|mint → tokenAddress`, `limit → Number`.
- `src/scrapers/crypto/dexscreener/normalizer.js:203-236` — `normalizeTokenLookup` trả `{type:'token_lookup', data:{chain_id, token_address, pair_count, pairs:[{dex_id, pair_address, pair_url, base_symbol, base_name, price_usd, price_native, liquidity_usd, volume_24h, price_change_24h, pair_created_at}]}}`.
- `src/scrapers/crypto/dexscreener/normalizer.js:243-259` — `normalizeBoostedToken` trả từng item `{type:'boosted_token', data:{token_address, chain_id, amount, total_amount, url, description, icon}}`; crawler `latest_boosted` trả **mảng** các record này (`crawler.js:218-229`, cắt theo `limit`).
- `src/scrapers/crypto/dexscreener/crawler.js:133-158` — `token_lookup` BẮT BUỘC cả `chainId` lẫn `tokenAddress` (throw nếu thiếu một trong hai). Hệ quả: không tra cứu chỉ bằng symbol được.
- `apps/web/app/api/[...path]/route.ts:1-36` — BFF catch-all: mọi `/api/*` proxy sang backend qua `proxyToBackend`. Endpoint scrape là `POST /api/platform/dexscreener/scrape`.
- `apps/web/lib/api.ts:38-119` — `api(method, path, {body, signal})` trả `ApiResult<T>` (`{ok, status, data|error}`); tự unbox envelope `{success, data}` nhưng GIỮ nguyên gateway envelope (có `mode`/`operationId`/`metadata`).
- `apps/web/app/pumpfun/page.tsx:135-160` — pattern chuẩn cần mirror: `scrape()` gọi `api('POST','/api/platform/<platform>/scrape', {body:{action, ...args}})`, nếu `isAsyncAccepted` thì `pollOperation`, nếu có `result` thì unwrap `env.result`. Dexscreener sync-capable nên bình thường trả sync, nhưng vẫn phải xử lý nhánh 202 degrade.
- `apps/web/lib/scrape-poll.ts:18-33` — `isAsyncAccepted` + `pollOperation(statusUrl, signal, retryAfterMs)`.
- `apps/web/lib/nav.ts:31-93` — `NAV_GROUPS`; nhóm `intelligence` (`:35-45`) đang có Analytics, OSINT, Graph, Price Correlation, Benchmark, Explorer, Facebook, Pump.fun. Thêm item Dexscreener tại đây — sidebar/breadcrumb/⌘K tự nhận vì cùng đọc `NAV_GROUPS`.
- `apps/web/lib/ipfs-image.ts` — `proxiedImageUrl` (proxy ảnh IPFS qua `/api/ipfs/[cid]`); chỉ dùng nếu icon là URL `ipfs://`, còn icon dexscreener thường là URL https thường.
- `tests/web/a2a.test.js:1-19` — pattern test frontend: đọc source `.tsx` bằng `readFileSync` rồi assert chứa/không chứa chuỗi (vitest, `environment: 'node'`, `include: tests/**/*.test.js`). Alias `@` → `apps/web` đã có trong `vitest.config.js`.

## Tasks & Acceptance

**Execution:**
- `apps/web/app/dexscreener/page.tsx` -- tạo mới client component: ô nhập địa chỉ token + bộ badge chain (All/Solana/Base/Ethereum/BSC) + dropdown sort; submit gọi `token_lookup` (chain cụ thể) và render lưới card từ `data.pairs`; trạng thái chưa search thì gọi `latest_boosted` render feed trending lọc theo chain; card gồm symbol/name, DEX badge, giá USD, pill % 24h xanh/đỏ, volume 24h, liquidity, badge "Pump.fun Origin" khi solana, nút "Copy Pair Address" (check 1.5s) và link "View on Dexscreener" (`pair_url`); empty state + Retry cho lỗi upstream và kết quả rỗng; ảnh `referrerPolicy="no-referrer"` kèm fallback. Mirror helper `scrape()` của pumpfun (unwrap `result`, nhánh `isAsyncAccepted`). -- Đây là toàn bộ surface của story.
- `apps/web/lib/nav.ts` -- thêm `{ label: 'Dexscreener', href: '/dexscreener', keywords: [...] }` vào mảng `items` của nhóm `intelligence`. -- Một nguồn nav duy nhất cho sidebar, breadcrumb và command palette.
- `tests/web/dexscreener.test.js` -- test theo pattern source-assertion: page là client component, dùng `api()` và `POST /api/platform/dexscreener/scrape`, gọi action `token_lookup` và `latest_boosted`, không có `fetch(` trực tiếp, có `referrerPolicy="no-referrer"`, có badge Pump.fun link `/pumpfun?mint=`, có empty state/Retry, và `nav.ts` chứa href `/dexscreener`. -- Khóa các hành vi quan sát được mà không cần jsdom.

**Acceptance Criteria:**
- Given người dùng mở `/dexscreener`, when trang tải, then feed trending (`latest_boosted`) hiển thị và ô tìm kiếm sẵn sàng nhận địa chỉ token.
- Given một địa chỉ token + chain, when bấm Search, then các card cặp giao dịch hiện đúng giá, % 24h (xanh/đỏ), volume và liquidity lấy từ `token_lookup`.
- Given một cặp Solana, when render card, then có badge "Pump.fun Origin" dẫn tới `/pumpfun?mint=<token_address>`.
- Given backend trả lỗi hoặc `pairs` rỗng, when render, then hiện empty state với nút Retry thay vì crash.
- Given sidebar, when nhìn nhóm Intelligence, then thấy mục "Dexscreener" điều hướng tới `/dexscreener`.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- verdicts: 27 findings — high 1, medium 3, low 10, false 12, maybe-false 1
- findings:
  - `[high]` `[patch]` useEffect phụ thuộc `executeLookup` (vốn phụ thuộc `addressInput`) nên mỗi lần gõ phím trong ô tìm kiếm gọi lại `latest_boosted` — `executeLookup` đổi danh tính mỗi keystroke, effect chạy lại và rơi nhánh `fetchBoosted()`. Sửa: effect chỉ phụ thuộc `params`, đọc state qua ref.
  - `[medium]` `[patch]` `detectChainFromAddress` trả `'base'` cho mọi địa chỉ EVM khi chọn "All Chains" — token Ethereum/BSC bị tra trên chain Base và trả rỗng/404. Sửa: khi "All" + địa chỉ EVM thì yêu cầu người dùng chọn chain thay vì đoán.
  - `[medium]` `[patch]` lookup lỗi không xóa `lookupData` cũ và view lỗi rơi xuống feed trending — người dùng thấy cặp token cũ hoặc danh sách trending thay vì trạng thái lỗi của token vừa tra. Sửa: xóa `lookupData` khi bắt đầu lookup; khi có lỗi lookup thì không render feed trending.
  - `[medium]` `[defer]` badge "Pump.fun Origin" hiện cho mọi cặp `chain_id==='solana'`, không chỉ token xuất phát từ Pump.fun — bấm vào dẫn `/pumpfun?mint=` trả 404 với SOL/USDC/Raydium. Backend `token_lookup` không trả cờ nguồn gốc bonding-curve (CAP-1 yêu cầu) nên không phân biệt được ở frontend; cần bổ sung tín hiệu backend ở story sau.
  - `[low]` `[reject]` lookup không đồng bộ địa chỉ/chain lên URL nên không bookmark/chia sẻ được — spec không yêu cầu deep-link; chỉ là cải tiến, không phải lỗi.
  - `[low]` `[reject]` không truyền AbortSignal nên request cũ có thể ghi đè kết quả mới — không có trạng thái nào chứng minh được race này xảy ra; thêm AbortController là thêm cơ chế mới, vượt mức sửa trực tiếp.
  - `[low]` `[reject]` badge Pump.fun dùng thẻ `<a>` thay vì `<Link>` nên tải lại toàn trang — hoạt động đúng, chỉ kém tối ưu; sửa đòi đổi cách điều hướng.
  - `[low]` `[reject]` card cặp không hiện ảnh token — normalizer `token_lookup` không trả trường icon; card đã có fallback chữ cái. Ảnh chỉ có ở feed boosted và đã xử lý đúng.
  - `[low]` `[reject]` không chuẩn hóa URL `ipfs://` qua `proxiedImageUrl` — icon boosted của dexscreener là URL https (cdn), không phải ipfs; chưa chứng minh ảnh vỡ.
  - `[low]` `[reject]` không hiện `pair_created_at` — spec không yêu cầu trường này.
  - `[low]` `[reject]` bấm badge chain ở view lookup không tự tra lại — lọc chain theo spec chỉ áp dụng cho feed trending; view lookup đã khóa chain lúc bấm Search.
  - `[low]` `[reject]` `fmtUsd` viết tắt K/M/B cho đơn giá — hàm này chỉ dùng cho giá token (giá >1000 hiếm); volume/liquidity dùng `fmtCompactUsd` riêng. Không gây hại thực tế.
  - `[low]` `[reject]` giao diện trộn Anh/Việt — cả hai ngôn ngữ đều hiển thị đúng, chỉ là chưa thống nhất; spec viết bằng tiếng Việt nhưng không cấm nhãn tiếng Anh.
  - `[low]` `[reject]` thiếu aria-label cho ô tìm kiếm và aria-pressed cho badge chain — dropdown sort đã có aria-label; phần còn lại là hoàn thiện accessibility ngoài phạm vi AC.
  - `[false]` `[reject]` Retry im lặng khi ô nhập rỗng — `addressInput` luôn được khởi tạo từ cùng query param mà effect dùng để tra, nên `executeLookup()` không bao giờ gặp địa chỉ rỗng sau một lookup lỗi.
  - `[false]` `[reject]` `fmtUsd` trả chuỗi số mũ cho số âm — nhánh `n < 0.000001` đứng sau `if (n === 0) return` và `n < 0` không xảy ra với giá/volume/liquidity (backend chỉ trả số không âm).
  - `[false]` `[reject]` comparator sort trả NaN khi field là NaN — normalizer ép `Number()` hoặc `null`, và UI dùng `?? 0`; không có đường nào tạo NaN.
  - `[false]` `[reject]` `handleSelectBoosted` gán `chain_id` ngoài ChainOption làm hỏng lọc — `latest_boosted` trả chain dexscreener hỗ trợ; một chain lạ chỉ làm badge không sáng và lọc ra đúng nhóm đó, không làm hỏng trạng thái.
  - `[false]` `[reject]` payload `ok:false` bị parse thành 0 cặp — nhánh lỗi là `else` của `res.ok && res.data`, đặt `lookupError` qua `mapError`, không đi vào `unwrapLookupData`.
  - `[false]` `[reject]` (verification-gap) regression ở `detectChainFromAddress`/`unwrapLookupData`/`sortedPairs` không có test chạy code — đây là component React mới, không có caller nào khác; consumer duy nhất là chính trang và test source-text là quy ước chung của `tests/web` (43 file cùng kiểu), không phải lỗ hổng regression của một hàm dùng chung.
  - `[false]` `[reject]` (verification-gap) `nav.ts` thêm item nhưng không test hành vi sidebar — `NAV_GROUPS` là dữ liệu; sidebar/breadcrumb/command-palette render nguyên mảng này, không có logic riêng để lệch. Test đã khóa sự hiện diện của href.
  - `[false]` `[reject]` (intent) card lookup không render `<img>` nên `referrerPolicy` vô hiệu ở view đó — ràng buộc ảnh nằm ở feed boosted (nơi có `icon`); view lookup không có URL ảnh để áp.
  - `[false]` `[reject]` (intent) badge Pump.fun nới điều kiện thêm `dex_id==='pumpfun'` — đây là siêu tập của điều kiện spec (`chain_id==='solana'`), không bỏ sót trường hợp spec yêu cầu.
  - `[false]` `[reject]` (intent) badge chain vẫn hiện ở view lookup nhưng không lọc `sortedPairs` — spec chỉ yêu cầu lọc ở feed trending và code làm đúng việc đó.
  - `[false]` `[reject]` (intent) `scrape()` có nhánh `isAsyncAccepted`/`pollOperation` dù spec nói `mode:'sync'` — nhánh này là bắt buộc theo pattern pumpfun (202 degrade), không mâu thuẫn với việc gửi `mode:'sync'`.
  - `[maybe-false]` `[defer]` request cũ có thể ghi đè kết quả mới khi người dùng tra cứu liên tiếp rất nhanh — cần reproduces thực tế với độ trễ mạng để xác nhận; nếu đúng là medium. Để mở.
  - Lưu ý gộp: edge-case hunter nêu lại 2 lỗi đã có (effect gõ phím = finding high đầu; payload ok:false = finding false nhánh res.ok) — cùng gốc, không tính thêm finding.


## Verification

**Commands:**
- `npx vitest run tests/web/dexscreener.test.js` -- expected: tất cả test PASS
- `npx tsc --noEmit -p apps/web/tsconfig.json` -- expected: không có lỗi type mới ở `app/dexscreener/page.tsx` và `lib/nav.ts`

**Manual checks (if no CLI):**
- `npm run dev` trong `apps/web`, mở `/dexscreener`: feed trending hiện; nhập một mint Solana thật (vd token pump.fun) + chain Solana cho ra card có giá và badge Pump.fun; badge chain lọc feed; nút copy đổi trạng thái.

## Auto Run Result

**Tóm tắt.** Thêm trang `/dexscreener` (client component) cho bộ DEX Intelligence: tra cứu cặp giao dịch theo chain + địa chỉ token (`token_lookup`) và feed token đang boost (`latest_boosted`) qua BFF `POST /api/platform/dexscreener/scrape` ở `mode: 'sync'`, kèm lọc chain, sắp xếp, badge Pump.fun, copy địa chỉ và link ngoài. Thêm mục "Dexscreener" vào nhóm điều hướng Intelligence.

**File đã đổi.**
- `apps/web/app/dexscreener/page.tsx` — trang mới: lookup + trending feed, card cặp, empty state/Retry, xử lý ảnh và badge Pump.fun.
- `apps/web/lib/nav.ts` — thêm một mục nav trong nhóm `intelligence`.
- `tests/web/dexscreener.test.js` — 11 test source-assertion theo quy ước `tests/web`.

**Review (27 findings).**
- Vá: 1 high (effect gọi lại API mỗi lần gõ phím — chuyển effect sang ref, chỉ phụ thuộc URL) và 2 medium (địa chỉ EVM khi chọn "All Chains" không còn bị đoán là Base mà yêu cầu chọn chain; lookup lỗi không còn giữ kết quả cũ hoặc rơi xuống feed trending).
- Hoãn: badge "Pump.fun Origin" gắn cho mọi cặp Solana vì backend không trả cờ nguồn gốc bonding-curve (medium); request lookup nhanh liên tiếp chưa có AbortController (medium, chưa xác minh).
- Bác 22 findings còn lại: 10 low (deep-link URL, AbortController, `<a>` thay `<Link>`, ảnh card lookup, ipfs, pair_created_at, lọc chain ở view lookup, fmtUsd, song ngữ, aria) vì không gây hại thực tế hoặc spec không yêu cầu; 12 false vì đã kiểm tra và kết quả xấu không xảy ra (Retry rỗng, fmtUsd số âm, sort NaN, chain lạ, payload ok:false, và các điểm verification-gap/intent không đứng vững).

**Follow-up review: true.** Có 1 entry mức high đã vá (vòng lặp gọi API theo từng ký tự). Rủi ro chưa kiểm lại độc lập: effect mới đọc state qua ref có thể bỏ lỡ một lần tải lại khi URL đổi đồng thời với state — cần một lượt review nữa xác nhận nhánh deep-link vẫn chạy đúng.

**Xác minh.**
- `npx vitest run tests/web/dexscreener.test.js` — 11/11 PASS (cả trước và sau khi vá).
- `npx tsc --noEmit -p apps/web/tsconfig.json` — không lỗi mới ở file đã đổi. 4 lỗi `TS18046` ở `apps/web/lib/api.ts` có sẵn từ baseline `c2897cfd`, không thuộc story này.

**Rủi ro còn lại.** Badge Pump.fun quá rộng (đã hoãn); chưa có test chạy logic React (toàn bộ `tests/web` dùng source-assertion vì môi trường vitest là `node`, không có jsdom).
