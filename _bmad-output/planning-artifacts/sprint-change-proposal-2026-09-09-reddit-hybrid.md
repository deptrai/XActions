---
title: 'Sprint Change Proposal — Epic 35: Reddit Hybrid Scraper'
type: sprint-change-proposal
status: approved
created: '2026-09-09'
updated: '2026-09-09'
---

# Sprint Change Proposal — Epic 35: Reddit Hybrid Scraper

## 1. Issue Summary

Live probe sau khi hoàn thành Story 35.1 (Reddit HTTP-only scraper) phát hiện **sai lệch giữa research cũ và thực tế mạng**:

- `https://www.reddit.com` homepage vẫn trả **HTTP 200**.
- Nhưng `https://www.reddit.com/r/{sub}/new.json` trả **HTTP 403** (Cloudflare/bot challenge) từ IP này.
- `https://old.reddit.com/r/{sub}/new.json` trả **HTTP 302 → login**.
- `https://www.reddit.com/r/{sub}/new.rss` trả **HTTP 200** — có thể dùng fallback.

Research `ref=[14]` chỉ verify homepage, chưa test `.json` endpoint. Kiến trúc và stories của Epic 35 dựa trên giả định Reddit = HTTP-only official API là đủ, thực tế cần **hybrid HTTP + Puppeteer stealth bridge + RSS fallback**.

## 2. Impact Analysis

### 2.1. Story 35.1 (Reddit)
- `RedditClient` cần thêm `transport: 'http' | 'puppeteer'`.
- `subreddit` action cần RSS fallback khi `.json` 403.
- `post_comments`, `user`, `search`, `subreddit_info` cần Puppeteer bridge cho public data khi không có OAuth/residential proxy.

### 2.2. Story 35.2 (Medium)
- Ít ảnh hưởng. RSS vẫn hoạt động.
- HTML fallback cần Puppeteer/stealth headers vì `medium.com/@x` trả 403.

### 2.3. Story 35.3 (Instagram)
- Ít ảnh hưởng. Đã planning hybrid (Puppeteer / instagrapi).

### 2.4. Architecture Spine (Epic 35)
- `AD-35-1` cần cập nhật: Reddit từ "HTTP-only" → "HTTP-first with Puppeteer/Stealth + RSS fallback".
- Thêm `IN-7`: Mọi client mới phải hỗ trợ `transport` option (`'http' | 'puppeteer' | 'rss'`).

### 2.5. PRD (FR-98)
- Cần bổ sung: "Puppeteer stealth fallback for public endpoints", "RSS fallback for subreddit post discovery".

### 2.6. Research
- `ref=[14]` cần cập nhật ghi rõ `.json` endpoint bị 403, chỉ homepage và RSS 200.
- Thêm section "Live verification 2026-09-09".

### 2.7. Files Affected
- `src/scrapers/social/reddit/client.js`
- `src/scrapers/social/reddit/crawler.js`
- `src/scrapers/social/reddit/normalizer.js` (parse RSS item)
- `src/scrapers/social/reddit/validator.js`
- `src/scrapers/social/reddit/index.js`
- `tests/scrapers/social/reddit/client.test.js`
- `tests/scrapers/social/reddit/crawler.test.js`
- `_bmad-output/planning-artifacts/research/technical-scraping-reddit-medium-instagram-2026-09-08/research.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/architecture/xactions-epic35-reddit-medium-instagram/ARCHITECTURE-SPINE.md`
- `_bmad-output/implementation-artifacts/stories/35-1-reddit-scraper.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## 3. Recommended Approach

### Phase 1 (Immediate — quick win)
Implement **RSS fallback** trong `RedditClient`:
- Khi `.json` 403, tự động retry với `.rss`.
- Parse Atom/RSS XML thành `PostItem[]` với đầy đủ `id`, `authorName`, `title`, `content`, `postUrl`, `publishedAt`.
- Không cần thêm dependency nặng; dùng `DOMParser` hoặc regex nhẹ (Node 18+ có `util.parseArgs`, không có XML parser built-in → cân nhắc `fast-xml-parser`).

### Phase 2 (Puppeteer stealth bridge)
Kế thừa pattern `ThreadsClient` / `FacebookClient`:
- Thêm `transport: 'puppeteer'`.
- Dùng `puppeteer-extra-plugin-stealth` mở Reddit, lấy cookies/session, rồi gọi `.json` API với cookie.
- Hỗ trợ actions: `subreddit`, `user`, `search`, `post_comments`, `subreddit_info`.

### Phase 3 (Docs update)
Cập nhật research, epics, prd, architecture, story với quyết định mới.

## 4. Detailed Change Proposals

### 4.1. `research.md`
**OLD:**
- `reddit.com` — HTTP 200 via curl, không cần proxy cho research [14].

**NEW:**
- `reddit.com` homepage — HTTP 200 via curl, không cần proxy [14].
- `reddit.com/r/{sub}/new.json` — HTTP 403 / Cloudflare bot challenge từ IP này; cần OAuth app + residential proxy hoặc Puppeteer stealth.
- `reddit.com/r/{sub}/new.rss` — HTTP 200, có thể dùng fallback không cần auth [14a].
- `old.reddit.com/r/{sub}/new.json` — HTTP 302 redirect to login [14b].

### 4.2. `epics.md` — AD-35
**OLD:**
- **AD-35**: Reddit và Medium dùng HTTP-only adapter (không cần browser).

**NEW:**
- **AD-35**: Reddit dùng **HTTP-first với RSS fallback + Puppeteer stealth bridge** cho public endpoints; Medium dùng RSS-first với HTML/Puppeteer fallback.

### 4.3. `prd.md` — FR-98
**OLD:**
- FR-98 (Reddit REST API Scraper): ... hỗ trợ OAuth2 read-only mode ...

**NEW:**
- FR-98 (Reddit Hybrid Scraper): Cào subreddit, post, comment, user, search qua **official REST API + RSS fallback + Puppeteer stealth bridge**; hỗ trợ OAuth2 read-only mode; normalize `t3` → `PostItem`, `t1` → `CommentItem`, `t5` → `CommunityItem`.

### 4.4. `ARCHITECTURE-SPINE.md`
**OLD:**
- **AD-35-1**: Reddit dùng HTTP-only (không cần browser) vì official API ổn định.

**NEW:**
- **AD-35-1**: Reddit dùng **HTTP-first** với **RSS fallback** khi `.json` 403, và **Puppeteer stealth bridge** khi cần full API data (comments, user profile, search) mà không có OAuth app/residential proxy.

Thêm `IN-7`: Mọi client mới phải hỗ trợ `transport` option (`'http' | 'puppeteer' | 'rss'`) để chọn adapter phù hợp.

### 4.5. `35-1-reddit-scraper.md`
- Mở lại story, status từ `done` → `in-progress`.
- Thêm task:
  - [ ] Implement RSS fallback trong `RedditClient`.
  - [ ] Implement Puppeteer stealth bridge (tùy chọn transport).
  - [ ] Cập nhật normalizer/validator cho RSS item.
  - [ ] Live test cào thực tế `r/vietnam`.

## 5. Implementation Handoff

- **Scope:** Moderate (code + docs + live verification).
- **Owner:** Developer (Claude / XActions dev) + Product Owner review.
- **Deliverables:**
  - RSS fallback merge vào `main`.
  - Puppeteer bridge skeleton.
  - Updated planning artifacts.
  - Live test report.
- **Success Criteria:**
  - `scrape('reddit', 'subreddit', { name: 'vietnam', limit: 5 })` trả `PostItem[]` từ IP này không cần API key.
  - `vitest` tests pass ≥ 90%.
  - Tài liệu planning phản ánh đúng kiến trúc hybrid.

## 6. References

- Research: `_bmad-output/planning-artifacts/research/technical-scraping-reddit-medium-instagram-2026-09-08/research.md`
- Architecture: `_bmad-output/planning-artifacts/architecture/xactions-epic35-reddit-medium-instagram/ARCHITECTURE-SPINE.md`
- PRD: `_bmad-output/planning-artifacts/prd.md` (FR-98)
- Epics: `_bmad-output/planning-artifacts/epics.md` (Epic 35)
- Story: `_bmad-output/implementation-artifacts/stories/35-1-reddit-scraper.md`
