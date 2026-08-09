# Facebook DOM Selectors Reference

> ⚠️ **STATUS: PARTIALLY VERIFIED — 2026-08-10.**
> Posts, Search, Profile scraping verified live on authenticated session.
> Followers, Groups, Friend actions still UNVERIFIED — need live test on secondary account.
> Facebook obfuscate class names (randomized, ví dụ `x1i10hfl`) và đổi DOM thường xuyên — **không** dựa vào class. Ưu tiên `role`, `aria-label`, text anchor.
> Dev phải chạy [Verify Checklist](#verify-checklist) trên account thật trước khi tin bất kỳ selector nào.

## Nguyên tắc chọn selector cho Facebook (NFR4)

Facebook KHÔNG có `data-testid` sạch như Twitter. Thứ tự ưu tiên:

1. **`role` + `aria-label`** — bền nhất. Ví dụ `[role="article"]`, `[aria-label="Like"]`.
2. **Text anchor** — tìm element theo text content (ví dụ nút có text "Followers").
3. **Structural** — quan hệ cha-con ổn định (ví dụ `[role="main"] [role="article"]`).
4. **Class name** — TUYỆT ĐỐI tránh. Class Facebook randomized, đổi mỗi deploy.

Mọi selector phải bọc trong helper một chỗ để khi Facebook đổi DOM chỉ sửa một nơi.

## Profile (FR-1)

| Element | Selector / Approach | Ghi chú |
|---|---|---|
| Profile name | `meta[property="og:title"]` → strip ` \| Facebook` suffix | **Primary** — stable, meta-first |
| Bio/intro | `meta[property="og:description"]` → strip leading follower count | Fallback: DOM text |
| Avatar | `meta[property="og:image"]` | CDN URL, stable |
| Follower count | Regex `/([\d,.]+[KkMm]?)\s*followers?/i` from `og:description` or `document.body.innerText` | Best-effort, `null` if absent |
| Meta fallback | `meta[property="og:title"]`, `og:description`, `og:image` | **Ổn định nhất** — ưu tiên hơn DOM |
| Blocked/missing detect | `og:title` absent or equals `"Facebook"` → return partial data with `error` field | Graceful degradation, avoids crash |

> **Approach used in `scrapeProfile`:** meta-first (`og:` tags via `page.evaluate`), DOM body text fallback for follower count. Still UNVERIFIED on a live authenticated session — DOM selectors may differ when logged in vs. public view.

## Posts (FR-2)

| Element | Selector / Approach | Ghi chú |
|---|---|---|
| Post container (desktop) | `[role="article"]` | **Primary** — used for profiles/pages |
| Post container (mobile/groups) | `div.m.displayed` | **Groups** — desktop doesn't load posts in headless mode |
| Post text | `[dir="auto"]` → pick text with most spaces (real text vs anti-scraping garbled) | VERIFIED 2026-08-10 |
| Anti-scraping cleanup | Remove U+034F (CGJ) + zero-width chars | FB inserts invisible chars between letters |
| Timestamp | `abbr` text or `[aria-label*="ago"]` | Mobile uses `abbr` with "Jul 16" format |
| Post URL | `a[href*="/posts/"]`, `a[href*="/permalink/"]`, `a[href*="story_fbid"]` | First match wins |
| Likes count | Regex `/([\d,.]+[KkMm]?)\s*(like\|reaction)/i` | Best-effort; default "0" |
| Comments count | Regex `/([\d,.]+[KkMm]?)\s*comment/i` | Best-effort; default "0" |
| Media images | `img` → filter static/emoji/non-http | Avatar images filtered |
| Video presence | `video` element | boolean hasVideo |

> **Approach used in `scrapeTweets`:** Desktop uses `[role="article"]`. Groups use mobile site (`m.facebook.com`) with mobile UA + `div.m.displayed` selector, filtered by date pattern. Text cleanup removes U+034F anti-scraping chars. Pick text with most spaces (real words vs garbled). VERIFIED 2026-08-10 on live session.

## Search (FR-4)

| Element | Selector / Approach | Ghi chú |
|---|---|---|
| Search URL | `${FACEBOOK_BASE}/search/posts?q=<encodeURIComponent(query)>` | Posts-specific search surface |
| Result container | `[role="article"]` | **Primary** — same as scrapeTweets |
| Result text | `[dir="auto"]` → pick text with most spaces (real text vs anti-scraping garbled) | VERIFIED 2026-08-10 |
| Anti-scraping cleanup | Remove U+034F (CGJ) chars | FB inserts U+034F between chars to prevent scraping |
| Author | First `a[href]` that is NOT a post permalink/search link | Extracts vanity handle from href |
| Timestamp | `abbr[data-utime]` or `time[datetime]` or text fallback | Best-effort |
| Post URL (id) | `a[href*="/posts/"]`, `a[href*="/permalink/"]`, `a[href*="story_fbid"]` | Preferred for stable `id` |

> **Approach used in `searchTweets`:** Navigate to `/search/posts?q=...`, extract `[role="article"]`, pick text with most spaces (real words vs garbled anti-scraping text), remove U+034F chars. VERIFIED 2026-08-10 on live session.

## Followers (FR-3) — ĐẶC BIỆT CẦN VERIFY

**Đây là blocker chính.** Trạng thái follower visibility trên Facebook (theo hiểu biết tới 2026, CẦN verify live):

| Loại tài khoản | Follower list công khai? | Ghi chú |
|---|---|---|
| **Page** (business/creator) | **Thường CÓ** phần nào | Tab "Followers"/"Likes" nếu page bật hiển thị. Đây là nguồn khả thi nhất. |
| **Personal profile** | **Thường KHÔNG** | FB ẩn friend/follower list cho hầu hết profile từ ~2020. Chỉ thấy "followed by X mutual" khi đã login & có liên hệ. |
| **Profile có "Followers" public** | Tùy setting user | Một số profile bật "Public" cho followers — hiếm. |

**Hệ quả thiết kế (đã phản ánh trong FR-3 và Story 1.4):** `scrapeFollowers` điều hướng đến `/<handle>/followers`, detect exposure bằng sự hiện diện của `[role="listitem"]` hoặc text "followers" trong body, rồi trả về:
- **Array** `[{ name, username, url, platform }]` nếu list hiển thị
- **Object** `{ note, username, platform }` nếu list bị ẩn — KHÔNG throw, KHÔNG trả mảng rỗng vô nghĩa

**Phương pháp detect (UNVERIFIED on live session):**
- Navigate to `facebook.com/<handle>/followers`
- Check `document.querySelectorAll('[role="listitem"]').length > 0` OR `/followers?/i` in body text
- If neither → restricted fallback

| Element | Selector / Approach | Ghi chú |
|---|---|---|
| Followers URL | `/${handle}/followers` | Page follower surface — UNVERIFIED |
| Follower row container | `[role="listitem"]` | UNVERIFIED — may differ on live session |
| Follower link | `a[href*="facebook.com"], a[href^="/"]` trong listitem | UNVERIFIED |
| Follower name | `span, strong` trong listitem | UNVERIFIED — pick first non-empty |
| Restricted detect | No `[role="listitem"]` AND no "followers" heading | Returns note object |

> **Open Question Q3 (PRD) — Resolution:** Based on Story 1.4 design, personal profiles return the `note` fallback. Pages with public followers are the only viable scrape target. Live verification required to confirm `[role="listitem"]` selector accuracy and whether `/followers` URL works for all Page types.

## Automate selectors (FR-6, FR-7, FR-8) — Epic 2

> ⚠️ Phần này dò sau, trong Epic 2. Dò trên **tài khoản phụ** vì thao tác ghi rủi ro khóa account cao (ADR-007).

| Element | Selector đề xuất (UNVERIFIED) | Ghi chú |
|---|---|---|
| Like button (not liked) | `[aria-label="Like"]` / `[aria-label="Thích"]` | **VERIFIED en** 2026-06-09 (Story 2.2 live test); vi UNVERIFIED |
| Like button (already liked) | `[aria-label="Remove Like"]` / `[aria-label="Bỏ thích"]` | en logic verified via `alreadyLiked` path; click-path UNVERIFIED live |
| Comment input (en) | `[aria-label*="Write a public comment"]`, `[aria-label*="Write a comment"]`, `[placeholder*="Write a comment"]` | Story 2.3; substring match. FB updated label to "Write a public comment…" (2026) |
| Comment input (vi) | `[aria-label*="Viết bình luận"]`, `[placeholder*="Viết bình luận"]` | Story 2.3; Vietnamese locale |
| Comment input (fallback) | `[role="textbox"][contenteditable="true"]` | Generic fallback for any locale |
| Comment submit | Enter key (`page.keyboard.press('Enter')`) | Story 2.3; most reliable method |
| Post submit | `[aria-label="Post"]` / `[aria-label="Đăng"]` | |

⚠️ **aria-label phụ thuộc locale.** Account đặt tiếng Việt sẽ có "Thích", "Bình luận", "Đăng". Helper phải hỗ trợ đa locale hoặc ép locale `en_US` khi login.
| Post composer (en) | `[aria-label*="What's on your mind"]`, `[role="textbox"][data-text*="What's on your mind"]` | Story 2.4; substring match |
| Post composer (vi) | `[aria-label*="Bạn đang nghĩ gì"]`, `[role="textbox"][data-text*="Bạn đang nghĩ gì"]` | Story 2.4; Vietnamese locale |
| Post submit (en) | `[aria-label="Post"]` | Story 2.4 |
| Post submit (vi) | `[aria-label="Đăng"]` | Story 2.4; Vietnamese locale |

## Share / Auto-share (FR-16) — Epic 4

> ⚠️ Story 4.2. Dò trên **account phụ** (thao tác ghi → rủi ro khóa, ADR-007).
> Share *button* đã VERIFIED (tái dùng từ Story 5.2); action "Share now → Feed" UNVERIFIED — cần confirm live.

| Element | Selector chain | Ghi chú |
|---|---|---|
| Share button | `div[data-ad-rendering-role="share_button"]`, `[data-ad-renderingrole="share_button"]` | **VERIFIED** (Story 5.2 `messengerShare.js` live test); reuse — KHÔNG tự chế selector mới |
| Share button (fallback) | `[aria-label*="Share"]` / `[aria-label*="Chia sẻ"]` | UNVERIFIED aria fallback nếu data-attr đổi |
| "Share now" action (en) | `[aria-label="Share now"]`, `div[role="menuitem"][aria-label*="Share now"]` | **UNVERIFIED** — share-to-Feed menu item; cần confirm live |
| "Share now" action (vi) | `[aria-label="Chia sẻ ngay"]`, `div[role="menuitem"][aria-label*="Chia sẻ ngay"]` | **UNVERIFIED** — Vietnamese locale |
| "Share now" text fallback | menuitem/button có text === `Share now` / `Chia sẻ ngay` | UNVERIFIED — `page.evaluateHandle` text-match khi aria selectors trượt |

⚠️ Flow: navigate postUrl → click Share button → chờ dialog → click "Share now". Combined `waitForSelector` (một wait cho cả list, không 5s×N). Throw rõ ràng + PII-free nếu không tìm thấy; `runGuardedBatch` ghi nhận lỗi per-item, KHÔNG abort batch.

## Groups — Join (FR-18) — Epic 4

> ⚠️ Story 4.4. Cluster-1 medium risk. Dò trên **account phụ** — join-spam là top checkpoint trigger.
> TẤT CẢ selector dưới đây **UNVERIFIED** — cần confirm live. Sàn delay 30s/join là invariant (NFR-6).

| Element | Selector chain (UNVERIFIED) | Ghi chú |
|---|---|---|
| Join button (en) | `[aria-label="Join group"]`, `[aria-label="Join Group"]`, `div[role="button"][aria-label*="Join"]` | UNVERIFIED — cần confirm trên group page |
| Join button (vi) | `[aria-label="Tham gia nhóm"]`, `div[role="button"][aria-label*="Tham gia"]` | UNVERIFIED — Vietnamese locale |
| Pending / requested (en) | `[aria-label="Cancel request"]`, `[aria-label="Requested"]` | UNVERIFIED — admin-approval state → `status:'pending'` (KHÔNG phải lỗi, FR-18) |
| Pending / requested (vi) | `[aria-label="Đã yêu cầu"]`, `[aria-label="Hủy yêu cầu"]` | UNVERIFIED — Vietnamese locale |
| Keyword search surface | `https://www.facebook.com/search/groups/?q=<keyword>`; group links `a[href*="/groups/"]` matching `/groups/<id>/?$` | UNVERIFIED — bounded scroll-collect up to `limit`, dedupe |

⚠️ Flow: navigate group → combined `waitForSelector` (pending + join list). Pending indicator trước → `status:'pending'` không click. Else click Join → check pending lại (admin-approval) → `joined`/`pending`. PII-free throw nếu không thấy. Keyword mode: search seam (injectable) scroll-collect URL rồi mỗi URL thành batch item.

## Groups — Batch Post (FR-19) — Epic 4

> ⚠️ Story 4.5. Cluster-1 medium risk. Dò trên **account phụ** — mass group posting là top spam-detection trigger.
> TẤT CẢ selector dưới đây **UNVERIFIED** — cần confirm live. Sàn delay 30s/post là invariant (NFR-6). Cap 10 groups mặc định.

| Element | Selector chain (UNVERIFIED) | Ghi chú |
|---|---|---|
| Group composer (en) | `[aria-label*="Write something"]` | UNVERIFIED — group page composer prompt |
| Group composer (vi) | `[aria-label*="Viết gì đó"]` | UNVERIFIED — Vietnamese locale |
| Group composer fallback (en) | `[aria-label*="What's on your mind"]` | UNVERIFIED — home-feed style fallback |
| Group composer fallback (vi) | `[aria-label*="Bạn đang nghĩ gì"]` | UNVERIFIED — home-feed style fallback |
| Group composer fallback (testid) | `[data-testid="status-attachment-mentions-input"]` | UNVERIFIED — stable testid fallback |
| Group composer fallback (role) | `div[role="textbox"][contenteditable="true"]` | UNVERIFIED — generic contenteditable |
| Submit / Post button (en) | `[aria-label="Post"]`, `div[aria-label="Post"][role="button"]` | UNVERIFIED — submit after typing |
| Submit / Post button (vi) | `[aria-label="Đăng"]`, `div[aria-label="Đăng"][role="button"]` | UNVERIFIED — Vietnamese locale |

⚠️ Flow: navigate groupUrl → `waitForSelector` (composer list, 8s timeout) → click composer → `keyboard.type(content)` → find + click submit → `{posted:true}`. PII-free throw nếu composer hoặc submit không tìm thấy. Facebook posts submit via XHR (không navigate) — post-success confirm selector là UNVERIFIED live-verify item. Tests dùng injected `postFn` seam, không phụ thuộc selector thật.

## Groups — Members (FR-20) — Epic 4

> ⚠️ Story 4.6. READ-ONLY scrape. KHÔNG phải batch write — không dùng runGuardedBatch, không có account-risk warning, không có 30s delay floor.
> TẤT CẢ selector dưới đây **UNVERIFIED** — cần confirm live. NFR-11: phone/email KHÔNG BAO GIỜ được collect dù có trong DOM.

| Element | Selector chain (UNVERIFIED) | Ghi chú |
|---|---|---|
| Member list container (en) | `[aria-label="Group members"]` | UNVERIFIED — outer container của member list |
| Member list container (vi) | `[aria-label="Thành viên nhóm"]` | UNVERIFIED — Vietnamese locale |
| Member list container (testid) | `div[data-pagelet="GroupMembersList"]` | UNVERIFIED — stable pagelet fallback |
| Member list container (generic) | `div[role="list"]` | UNVERIFIED — generic fallback |
| Member row | `[role="listitem"]` | UNVERIFIED — bên trong container |
| Member name | `span[dir="auto"]`, `strong`, `span` | UNVERIFIED — first text node trong listitem |
| Member profile link | `a[href*="/profile.php"]`, `a[href*="facebook.com/"]` | UNVERIFIED — link đến profile của member |
| Members tab URL | `{groupUrl}/members` | UNVERIFIED — cần confirm URL pattern cho group type |

⚠️ Flow: navigate `{groupUrl}/members` → `waitForSelector` (container list, 8s timeout). Nếu không thấy → return `{ note, platform }` (restricted/private). Nếu thấy → bounded scroll loop (`window.scrollTo(0, document.body.scrollHeight)` + 1-3s delay + stall detection). Extract member rows → `normalizeGroupMember` → NFR-11 strip phone/email. Return array. Tests dùng fake page + DOM fixture + injected `delay` seam, không phụ thuộc selector thật.

## Mobile Site Approach (Groups)

> Facebook desktop doesn't load posts in headless mode for groups. Mobile site (`m.facebook.com`) works.

**Configuration:**
- User-Agent: `Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15`
- Viewport: 390x844 (mobile)
- URL: `https://m.facebook.com/groups/<groupId>`
- Post selector: `div.m.displayed` (filter by date pattern)
- Text: `[dir="auto"]` with anti-scraping cleanup

**Date pattern filter:** Posts contain dates like "Jul 16", "2h", "3d ago". Filter `div.m.displayed` elements matching `/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+|\d+\s*(min|h|hour|day|week)s?\s*ago/i`.

VERIFIED 2026-08-10 on live session.

> ⚠️ Story 4.7. **Cluster-2 — HIGHEST account-risk action trong Epic 4.** Friend-request spam = top cause of checkpoint.
> Delay floor **60s** (DOUBLE group floor), batchLimit ≤ 20/session. Non-suppressible warning. TẤT CẢ selector **UNVERIFIED** — confirm live trên account phụ.
> NFR-11: phone/email KHÔNG BAO GIỜ được collect ở suggestions/location mode dù có trong DOM.

| Element | Selector chain (UNVERIFIED) | Ghi chú |
|---|---|---|
| Add Friend button (en) | `[aria-label="Add friend"]`, `[aria-label="Add Friend"]`, `div[role="button"][aria-label*="Add friend"]` | UNVERIFIED — click để gửi request |
| Add Friend button (vi) | `[aria-label="Thêm bạn bè"]`, `div[role="button"][aria-label*="Thêm bạn"]` | UNVERIFIED — Vietnamese locale |
| Already-friend indicator (en) | `[aria-label="Friends"]`, `div[role="button"][aria-label*="Friends"]` | UNVERIFIED — đã là bạn → skip (`already_friend`, ok:true, KHÔNG fail) |
| Already-friend indicator (vi) | `[aria-label="Bạn bè"]` | UNVERIFIED — Vietnamese locale |
| Pending indicator (en) | `[aria-label="Cancel request"]`, `[aria-label="Requested"]` | UNVERIFIED — request đã gửi → skip (`pending`, ok:true, KHÔNG fail) |
| Pending indicator (vi) | `[aria-label="Đã yêu cầu"]`, `[aria-label="Hủy yêu cầu"]` | UNVERIFIED — Vietnamese locale |
| People You May Know surface | `https://www.facebook.com/friends/suggestions`; profile links `a[href*="/profile.php"]`, `a[href]` matching profile pattern | UNVERIFIED — bounded scroll-collect, dedupe by profileUrl |
| Suggestion card name | `a` textContent, `span`, `strong` trong `div[role="listitem"]` | UNVERIFIED — chỉ collect name (NFR-11: KHÔNG phone/email) |
| Suggestion card location | `[class*="location"]`, `span[dir="auto"]:nth-of-type(2)` | UNVERIFIED — publicly self-declared location, dùng cho location-mode substring filter |

⚠️ Flow: **uid_list mode** — `targets` array → `assertFacebookUrl` mỗi URL → batch items trực tiếp. **suggestions mode** — navigate `/friends/suggestions` → scroll-collect profile URLs (injectable `searchFn`); dry-run KHÔNG drive browser (empty preview + warning). **location mode** — như suggestions + filter theo substring trên publicly self-declared location text. Per-profile: navigate → detect already-friend/pending TRƯỚC khi click → click Add Friend → `{sent, status}`. Skip states (`already_friend`/`pending`) là ok:true KHÔNG fail. PII-free throw nếu profile unreachable. Tests dùng injected `requestFn`/`searchFn`/`delay` seam, không phụ thuộc selector thật.

## Friends — Cancel Pending (FR-22) — Epic 4

> ⚠️ Story 4.8. Cluster-2, two-phase (collect → batch-cancel). Delay **2-5s** (thấp nhất Cluster-2; KHÔNG phải floor invariant — là spec value). Non-suppressible warning.
> Dry-run CHẠY Phase 1 (read) để show preview — KHÁC với 4.7 suggestions-mode (không drive browser). TẤT CẢ selector **UNVERIFIED**.

| Element | Selector chain (UNVERIFIED) | Ghi chú |
|---|---|---|
| Sent-requests surface | `https://www.facebook.com/friends/requests/sent` | UNVERIFIED — Phase 1 collect URL |
| Request row | `div[role="listitem"]` | UNVERIFIED — mỗi pending request |
| Request profile link | `a[href*="/profile.php"]`, `a[href]` matching profile pattern | UNVERIFIED — profileUrl của người nhận |
| Request name | `a` textContent, `span`, `strong` | UNVERIFIED — tên người nhận (NFR: không PII) |
| Date sent | `span[dir="auto"]:last-of-type`, `abbr` | UNVERIFIED — "Sent X days ago"/"Đã gửi X ngày trước" → parse age |
| Cancel button (en) | `[aria-label="Cancel request"]`, `[aria-label="Requested"]`, `div[role="button"][aria-label*="Cancel request"]` | UNVERIFIED — click để hủy |
| Cancel button (vi) | `[aria-label="Hủy yêu cầu"]`, `[aria-label="Đã yêu cầu"]`, `div[role="button"][aria-label*="Hủy yêu cầu"]` | UNVERIFIED — Vietnamese locale |

⚠️ Flow: **Phase 1 (read)** — navigate `/friends/requests/sent` → bounded scroll (`window.scrollTo` + 1-3s delay + stall detection) → extract `{name, profileUrl, dateSent}` → filter `olderThanDays` (unparseable date → INCLUDE) → cap `limit`. **Dry-run dừng tại đây**, trả `{pending, count}`. **Phase 2 (write)** — mỗi profileUrl → `runGuardedBatch` (delay 2-5s) → `cancelSingleRequest`: navigate profile → click Cancel → `{cancelled}`. PII-free throw nếu button không thấy. Transform result → `{cancelled, failed, remaining}`. Tests dùng injected `collectFn`/`cancelFn`/`delay` seam.

## Verify Checklist

Dev chạy trên account thật (ưu tiên account phụ), đánh dấu khi verify:

### Scrape (Epic 1)
- [x] **Profile**: meta-first approach works, returns partial data if blocked (VERIFIED 2026-08-10)
- [x] **Profile meta fallback**: `og:title`/`og:description` parse name + follower count
- [x] **Posts**: mobile site + `div.m.displayed` for groups, date pattern filter (VERIFIED 2026-08-10)
- [x] **Posts text cleanup**: Remove U+034F anti-scraping chars, pick text with most spaces (VERIFIED 2026-08-10)
- [ ] **Posts pagination**: xác nhận scroll load thêm post + bounded retry hoạt động
- [ ] **Followers — Page**: mở 1 Page có tab Followers, xác nhận lấy được list. Ghi selector.
- [ ] **Followers — Personal**: mở 1 personal profile, xác nhận KHÔNG lấy được → adapter trả `note` đúng (không crash).
- [x] **Search**: `[role="article"]` + text cleanup works (VERIFIED 2026-08-10)

### Automate / Growth (Epic 2 + Epic 4)
- [ ] **Share button**: mở 1 post, xác nhận `div[data-ad-rendering-role="share_button"]` click mở được Share dialog.
- [ ] **Share now → Feed**: trong dialog, xác nhận selector/text "Share now"/"Chia sẻ ngay" click được và repost lên timeline. Ghi selector thật. (Story 4.2 — hiện UNVERIFIED)
- [ ] **Join group button**: mở 1 group chưa join, xác nhận selector Join click được + chuyển sang joined/pending. Ghi selector thật. (Story 4.4 — UNVERIFIED)
- [ ] **Group pending state**: mở 1 group đã request, xác nhận pending indicator (`Requested`/`Đã yêu cầu`) detect đúng → `status:'pending'`. (Story 4.4 — UNVERIFIED)
- [ ] **Keyword group search**: chạy `/search/groups/?q=<kw>`, xác nhận `a[href*="/groups/"]` collect được group URLs qua scroll. (Story 4.4 — UNVERIFIED)
- [ ] **Group post composer**: mở 1 group page là thành viên, xác nhận selector `[aria-label*="Write something"]`/`[aria-label*="Viết gì đó"]` click được + `keyboard.type` hoạt động. Ghi selector thật. (Story 4.5 — UNVERIFIED)
- [ ] **Group post submit**: sau khi type content, xác nhận `[aria-label="Post"]`/`[aria-label="Đăng"]` click được và post xuất hiện trong group. (Story 4.5 — UNVERIFIED)
- [ ] **Group post XHR confirm**: xác nhận post thực sự được tạo (không chỉ submit button click) — tìm post-success indicator nếu có. (Story 4.5 — UNVERIFIED live-verify item)
- [ ] **Group members container**: mở 1 public group là thành viên, navigate `{groupUrl}/members`, xác nhận `[aria-label="Group members"]` hoặc `[data-pagelet="GroupMembersList"]` render được. Ghi selector thật. (Story 4.6 — UNVERIFIED)
- [ ] **Group member rows**: xác nhận `[role="listitem"]` bên trong container bắt được member rows; verify lấy được name + profileUrl. (Story 4.6 — UNVERIFIED)
- [ ] **Group members restricted**: mở 1 private group KHÔNG phải thành viên, xác nhận `waitForSelector` timeout → function trả `{ note, platform }` không throw. (Story 4.6 — UNVERIFIED)
- [ ] **Group members URL pattern**: xác nhận `{groupUrl}/members` là URL đúng cho tab members (có thể khác với group type). Ghi URL pattern thực tế. (Story 4.6 — UNVERIFIED)
- [ ] **Add Friend button**: mở 1 profile chưa kết bạn, xác nhận `[aria-label="Add friend"]`/`[aria-label="Thêm bạn bè"]` click được + đổi sang pending. Ghi selector thật. (Story 4.7 — UNVERIFIED)
- [ ] **Already-friend detect**: mở 1 profile đã là bạn, xác nhận `[aria-label="Friends"]`/`[aria-label="Bạn bè"]` detect đúng → `status:'already_friend'` (skip, KHÔNG click). (Story 4.7 — UNVERIFIED)
- [ ] **Pending detect**: mở 1 profile đã gửi request, xác nhận `Requested`/`Đã yêu cầu` detect đúng → `status:'pending'` (skip). (Story 4.7 — UNVERIFIED)
- [ ] **Friend request XHR confirm**: sau khi click Add Friend, xác nhận button đổi sang pending (confirm request thực sự fired, không silent success). (Story 4.7 — UNVERIFIED live-verify item)
- [ ] **People You May Know surface**: navigate `/friends/suggestions`, xác nhận scroll-collect được profile URLs + name + location. (Story 4.7 — UNVERIFIED)
- [ ] **Suggestion location field**: xác nhận selector lấy được publicly self-declared location text cho location-mode filter (NFR-11: KHÔNG lấy phone/email). (Story 4.7 — UNVERIFIED)
- [ ] **Sent-requests surface**: navigate `/friends/requests/sent`, xác nhận `div[role="listitem"]` bắt được pending request rows + profileUrl + name. (Story 4.8 — UNVERIFIED)
- [ ] **Date sent parse**: xác nhận text "Sent X days ago"/"Đã gửi X ngày trước" lấy được + parse ra age days đúng. (Story 4.8 — UNVERIFIED)
- [ ] **Cancel request button**: mở 1 profile đã gửi request, xác nhận `[aria-label="Cancel request"]`/`[aria-label="Hủy yêu cầu"]` click được + request bị hủy. (Story 4.8 — UNVERIFIED)

### Cập nhật sau verify
- [ ] Thay mọi selector "UNVERIFIED" bằng selector thật đã test.
- [ ] Đổi header status thành `VERIFIED <tháng/năm>`.
- [ ] Ghi lại field follower nào THỰC SỰ lấy được (resolves Open Question Q3 trong PRD).
- [ ] Note locale nào đã test (vì aria-label đổi theo ngôn ngữ).

## Tham chiếu chéo

- Pattern tham khảo: `src/scrapers/threads/index.js` (Meta product, cùng cách parse meta tags).
- Cookie: `docs/agents/facebook-session-cookie.md`.
- Architecture: Addendum A.6 (selector obfuscation risk).
- PRD: FR-1..FR-4, NFR4, Open Question Q3.

## Password Login & 2FA (Story 5.3 — FR30, FR31)

> ⚠️ **UNVERIFIED** — tất cả selector dưới đây chưa được test trên session thật.
> Chạy [Verify Checklist — Auth](#verify-checklist--auth-story-53) trên account phụ trước khi dùng.
> NFR3: uid, pass, bait-cookie value, TOTP seed KHÔNG BAO GIỜ được log.

### Login form (`/login`)

| Element | Selector chain (UNVERIFIED) | Ghi chú |
|---|---|---|
| Email / uid field | `#email` → `input[name="email"]` → `input[type="email"]` | Thử lần lượt theo thứ tự; `#email` là primary theo C# ref |
| Password field | `#pass` → `input[name="pass"]` → `input[type="password"]` | `#pass` là primary theo C# ref |
| Login button | `button[name="login"]` → `[data-testid="royal_login_button"]` → `button[type="submit"]` | `data-testid` ổn định hơn nếu còn tồn tại |
| Bait cookie | `page.setCookie({ name, value, domain: '.facebook.com' })` | Cookie phụ, giúp form render đúng — tên/giá trị phụ thuộc provider |

### "Continue" / device-save interstitial

| Element | Selector (UNVERIFIED) | Ghi chú |
|---|---|---|
| "Continue" button (en) | `[value="Continue"]` | Xuất hiện sau login đầu tiên trên device mới |
| "Tiếp tục" button (vi) | `[value="Tiếp tục"]` | Locale tiếng Việt |
| Save-device button | `[data-testid="save-device-button"]` | Nếu `data-testid` còn tồn tại |

> Interstitial này **không phải 2FA** — chỉ là prompt "save this device". Click qua để tiếp tục.

### 2FA checkpoint (`/checkpoint/`)

| Element | Selector (UNVERIFIED) | Ghi chú |
|---|---|---|
| TOTP code input | `input[name="approvals_code"]` → `input[id*="approvals_code"]` → `input[autocomplete="one-time-code"]` | Facebook dùng `approvals_code` theo C# MNST_DT1.cs ref |
| Submit button | `#checkpointSubmitButton` → `button[type="submit"]` | `#checkpointSubmitButton` là stable id theo C# ref |

> **Seed format:** 32-char base32 string (không có dấu cách). `generateTotp(seed)` dùng `otplib` `authenticator.generate` với default period=30s, digits=6, SHA1.
> Nếu seed rỗng hoặc không hợp lệ, `generateTotp` trả `null` (không throw).

### Proxy auth (`page.authenticate`)

```js
// Sau createBrowser + createPage, nếu proxy có creds:
const descriptor = await rotateProxy('proxyfb', apiKey);
const browser = await createBrowser({ proxy: descriptor.server }); // --proxy-server=http://host:port
const page = await createPage(browser);
if (descriptor.username) {
  await page.authenticate({ username: descriptor.username, password: descriptor.password });
}
```

> `page.authenticate` phải gọi **trước** `page.goto` đầu tiên.
> `descriptor.server` = `http://host:port` từ `rotateProxy`.

### Verify Checklist — Auth (Story 5.3)

- [ ] **Email field**: xác nhận `#email` bắt được field trên `/login`.
- [ ] **Password field**: xác nhận `#pass` bắt được field.
- [ ] **Login button**: xác nhận `button[name="login"]` hoặc `[data-testid="royal_login_button"]` click được.
- [ ] **Continue interstitial**: xác nhận prompt xuất hiện và `[value="Continue"]` / `[value="Tiếp tục"]` click được.
- [ ] **2FA checkpoint**: xác nhận trang checkpoint render `input[name="approvals_code"]` và `#checkpointSubmitButton`.
- [ ] **Proxy**: xác nhận session chạy đúng IP khi dùng `--proxy-server=` arg.
- [ ] **Bait cookie**: xác nhận inject trước navigate không bị reject.

