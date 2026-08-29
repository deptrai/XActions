# ATDD Checklist — Story 15.1.3: Threads Hybrid DocID Hardening for Search & Comments

**Story ID:** 15.1.3  
**Epic:** 15 — Vietnam Viral Social — Threads & TikTok Scraper Engine  
**Status:** 🟢 Green (All 5 Acceptance Tests Passing)  
**Generated:** 2026-08-29  

---

## Acceptance Criteria Mapping & Test Status

### AC-1: `DEFAULT_THREADS_DOC_IDS` Configuration
* File: `tests/scrapers/social/threads/docid-hardening.test.js`
- [x] `defines default doc_ids for SEARCH_POSTS, COMMENT_ROOTS, and COMMENT_REPLIES` ➔ 🟢 **Passing**

---

### AC-2: GraphQL-First Search Execution with Fallback
* File: `tests/scrapers/social/threads/docid-hardening.test.js`
- [x] `executes search via GraphQL when SEARCH_POSTS is configured and preserves pageInfo` ➔ 🟢 **Passing**
- [x] `falls back to HTTP SSR search when GraphQL SEARCH_POSTS query fails` ➔ 🟢 **Passing**

---

### AC-3: Multi-Layer GraphQL Comment Tree Execution
* File: `tests/scrapers/social/threads/docid-hardening.test.js`
- [x] `queries COMMENT_ROOTS and COMMENT_REPLIES to build multi-depth comment tree` ➔ 🟢 **Passing**
- [x] `gracefully degrades to POST_DETAIL fallback when comment doc_ids are unconfigured` ➔ 🟢 **Passing**

---

### AC-4 & AC-5: Deprecation & Error Hardening
* File: `docs/deprecation-plan.md` & `src/scrapers/social/threads/crawler.js`
- [x] `logs warning when GraphQL query fails and executes fallback without data loss` ➔ 🟢 **Passing**
- [x] `updates docs/deprecation-plan.md status tracker for hardened search & comments` ➔ 🟢 **Passing**
