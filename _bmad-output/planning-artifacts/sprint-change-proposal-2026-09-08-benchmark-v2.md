---
title: "Sprint Change Proposal v2 — Epic 34: Scraper Benchmark & Reliability Suite"
date: 2026-09-08
status: draft
scope: major
supersedes: sprint-change-proposal-2026-09-08-benchmark.md
reviewed_by: [John-PM, Winston-Architect, Murat-TestArchitect]
---

# Sprint Change Proposal v2

**Date:** 2026-09-08  
**Project:** XActions  
**Triggering issue:** Sau khi phân tích chiến lược với Mary (BMad Analyst), Luisphan quyết định ưu tiên xây dựng **Benchmark tiêu chuẩn đo lường độ ổn định, chất lượng, độ nhiễu, chi phí** của tất cả scraper trước khi phát triển thêm tính năng mới. Đây là điều kiện tiên quyết để đảm bảo Nowing nhận được dữ liệu đáng tin cậy.

**Post-review updates:** Incorporated feedback from PM (John), Architect (Winston), and Test Architect (Murat). See `_bmad-output/planning-artifacts/review-epic34-synthesis-2026-09-08.md`.

---

## Section 1 — Issue Summary

### Problem statement
1. **Không thể tối ưu những gì chưa đo được:** XActions có 15+ platform scrapers nhưng không có hệ thống định lượng nào để đánh giá sức khỏe từng scraper.
2. **Silent degradation:** Scraper có thể trả về rỗng hoặc dữ liệu lỗi mà không ai biết (selector drift, False 200 OK, checkpoint).
3. **Chi phí ẩn:** Không có cách nào biết scraper nào đang "đốt" proxy bandwidth hoặc tài khoản một cách lãng phí.
4. **Nowing phụ thuộc vào dữ liệu XActions:** Nếu scraper hỏng mà không phát hiện, Nowing CRM sẽ nhận "rác" hoặc thiếu lead.

### Decision from Luisphan (2026-09-08)
- **Tier C scrapers:** Chỉ cảnh báo operator, **không** tự động ngắt Nowing ingestion (human-in-the-loop).
- **Benchmark scope:** Đo trên **dữ liệu production thực tế**, không chỉ canary URLs.
- **Alerting:** Bổ sung push-notification (Slack/Telegram/Webhook) cho human-in-the-loop ngoài giờ làm việc.

---

## Section 2 — Proposed Change

### New Epic: Epic 34 — Scraper Benchmark & Reliability Suite

**Mục tiêu:** Xây dựng hệ thống đo lường 4-trục (Stability, Quality, Noise, Cost) để chấm điểm sức khỏe mọi scraper trong XActions.

**Spec reference:** `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` + `metrics-catalog.md`

### Epic 34 Stories (Revised)

| Story | Title | Mô tả | Dependencies | Phase |
|-------|-------|-------|-------------|-------|
| **34.1** | Benchmark Telemetry Schema & Storage | Định nghĩa Prisma model `ScraperHealthScore`, `ScraperCanaryRun`; Redis Stream `stream:benchmark:telemetry` (Tier 1: raw) + PostgreSQL rollups (Tier 2: aggregated) | Epic 10.2, Epic 10.5 | MVP |
| **34.2** | Production Telemetry Hooks in AbstractCrawler | Thêm telemetry emission vào `AbstractCrawler.start()`, `BaseApiClient.request()` — fire-and-forget `setImmediate`, in-memory buffer, batch flush to Redis | Epic 10.1, Epic 11.3 | MVP |
| **34.3** | Platform-Specific Validators & False-200 Detection | Mở rộng `AbstractPlatformResponseValidator` để detect Cloudflare/Arkose/login-wall/empty-page cho từng platform | Epic 11.6, per-platform scrapers | Hardening |
| **34.4** | Benchmark Scoring Engine | Cron job tính Health Score (0-100) theo công thức weighted 4-pillar + **hard knock-out gates** (True Success <80% OR Field Fill <85% → cap Tier C); classify Tier A/B/C | 34.1, 34.2, 34.3 | MVP |
| **34.5** | Operator Scorecard CLI & Dashboard | CLI `xactions benchmark` (list, run, history, platform detail); dashboard health matrix trong `dashboard/admin.html` | 34.4, Epic 19 | MVP |
| **34.6** | Nowing Integration: Health Flag in Stream Events | Thêm `benchmark_health: "A" | "B" | "C"` + `benchmark_alert: boolean` vào thin event payload gửi Nowing; Nowing có thể filter hoặc flag theo tier | 34.4, Epic 14.3 | MVP |
| **34.7** | Synthetic Canary Probe Scheduler | Scheduled canary probes (hourly) với fixed test URLs per platform; ghi vào `ScraperCanaryRun`; đảm bảo low-volume scrapers có data points | 34.1 | Hardening |
| **34.8** | Active Alerting & Re-qualification Workflow | Slack/Telegram/Webhook push notifications; re-qualification rules (N consecutive clean runs → promote tier) | 34.4, 34.5 | Hardening |

### New Functional Requirements

| FR | Title | Mô tả |
|----|-------|-------|
| **FR-98** | Scraper Benchmark Telemetry | Hệ thống phải emit structured telemetry cho mọi scrape run: true_success, latency_ms, field_fill_rate, schema_valid, proxy_bytes, duplicate_flag, contact_valid |
| **FR-99** | Benchmark Scoring Engine | Cron job tính Health Score per scraper per platform theo công thức weighted 4-pillar + hard knock-out gates; lưu vào `ScraperHealthScore` |
| **FR-100** | Operator Benchmark CLI & Dashboard | `xactions benchmark` command và dashboard view hiển thị Tier A/B/C, trend, drill-down metrics |
| **FR-101** | Nowing Health Flag & Alert | Thin event payload thêm `benchmark_health` + `benchmark_alert`; Nowing consume flag để filter/alert |
| **FR-102** | Synthetic Canary Probes | Scheduled hourly probes trên fixed URLs per platform; lưu `ScraperCanaryRun` |
| **FR-103** | Active Alerting & Re-qualification | Push notifications (Slack/Telegram/Webhook); re-qualification workflow (N clean runs → promote) |

### New Non-Functional Requirements

| NFR | Title | Mô tả |
|-----|-------|-------|
| **NFR-19** | Benchmark Overhead | Telemetry emission phải < 1% latency overhead và < 5% memory overhead trên mỗi scrape run; fire-and-forget, non-blocking |
| **NFR-20** | Benchmark Data Retention | Raw telemetry Redis TTL 7 ngày; `ScraperHealthScore` giữ 90 ngày; dashboard query < 500ms |
| **NFR-21** | Benchmark Sampling | Per-item sampling (không ghi mọi request) cho high-volume scrapers để giữ overhead trong giới hạn |

---

## Section 3 — Impact Analysis

### Epic Impact

| Epic | Impact | Required change |
|------|--------|---------------|
| **Epic 10** | Minor | Thêm `ScraperHealthScore`, `ScraperCanaryRun` models vào Prisma schema |
| **Epic 11** | Minor | Thêm proxy bandwidth tracking vào `AbstractApiClient` |
| **Epic 13-18** | None | Platform crawlers **không cần thay đổi** — telemetry hooks trong `AbstractCrawler` |
| **Epic 14** | Minor | Thêm `benchmark_health` + `benchmark_alert` vào thin event payload |
| **Epic 19** | Moderate | Thêm benchmark dashboard view và CLI commands |
| **Epic 20** | None | Decommission không ảnh hưởng |
| **Epic 27-28** | Merge | Story 34.3 overlap với `28-2-selector-canary`, `28-1-schema-drift-guard`, `27-3-challenge-signature-detector` — merge scope |

### Story Impact

| Story | Change needed |
|-------|-------------|
| 10.2 | Thêm models `ScraperHealthScore`, `ScraperCanaryRun` |
| 10.5 | Thêm benchmark telemetry schema vào `MetadataSchemaRegistry` |
| 11.3 | Thêm proxy byte counting vào request pipeline |
| 14.3 | Thêm `benchmark_health` + `benchmark_alert` fields vào stream payload |
| 19.x | Thêm benchmark dashboard section và CLI commands |
| 27.3, 28.1, 28.2 | Merge scope với Story 34.3 (False-200 detection) |

### Artifact conflicts

| Artifact | Conflict / update needed |
|----------|--------------------------|
| **PRD** `prd.md` | Append FR-98..FR-103, NFR-19, NFR-20, NFR-21 |
| **Epics** `epics.md` | Append Epic 34 với 8 stories (6 MVP + 2 Hardening) |
| **Sprint Status** `sprint-status.yaml` | Thêm Epic 34 và stories vào backlog |
| **Architecture** `ARCHITECTURE-SPINE.md` | Thêm AD-23: Two-Tier Benchmark Architecture |
| **SPEC** `spec-scraper-benchmark/SPEC.md` | Update CAP-4, Success Signal: alert-only (không auto-gate) |
| **Metrics Catalog** `metrics-catalog.md` | Update Tier Classification: alert-only; add normalization appendix; add category-specific metric profiles |

---

## Section 4 — Recommended Approach

**Direct Adjustment** — append Epic 34 vào backlog; không rollback hay restructure epic hiện có.

**Rationale:**
- Epic 34 là additive: không thay đổi logic scraper hiện có, chỉ thêm measurement layer.
- Tất cả platform scrapers (Epic 13-18, 21-22, 33) sẽ benefit từ benchmark ngay khi được implement.
- Có thể chạy song song với các epic đang in-progress (Epic 22) vì không conflict.

**Effort estimate (revised post-review):**
- 34.1 (Schema): 0.5 sprint
- 34.2 (Telemetry hooks): 1 sprint (touch AbstractCrawler only, not platform crawlers)
- 34.3 (Validators): 1-2 sprints (per-platform tuning) — **Phase 2, merge với Epic 27/28**
- 34.4 (Scoring): 0.5 sprint
- 34.5 (CLI/Dashboard): 1 sprint
- 34.6 (Nowing flag): 0.5 sprint
- 34.7 (Canary probes): 0.5 sprint — **Phase 2**
- 34.8 (Alerting/Re-qualification): 0.5 sprint — **Phase 2**
- **Total: 4-5 sprints (Phase 1: 3 sprints, Phase 2: 1-2 sprints)**

**Risk:** Low — telemetry là side-car, không block main flow. Có thể toggle off nếu có vấn đề.

---

## Section 5 — Handoff

| Role | Responsibility |
|------|---------------|
| **Winston (Architect)** | Review Epic 34 stories, define `TelemetryEmitter` interface, decide Redis Stream vs. Prisma for raw telemetry, add AD-23 to ARCHITECTURE-SPINE.md |
| **Amelia (Dev)** | Implement stories 34.1-34.6 in order; start with 34.1 schema + 34.2 hooks |
| **Murat (Test Architect)** | Scaffold `tests/benchmark/` test suites (ATDD red phase) trước khi dev implement; review NFR-19/20 validation |
| **Mary (Analyst)** | Validate metrics catalog thresholds with Nowing team; confirm Tier A/B/C boundaries; add normalization appendix |
| **John (PM)** | Prioritize Epic 34 trong sprint planning; decide if it blocks or parallels Epic 22 |

---

## Section 6 — Approval & Next Steps

**Proposed priority:** Epic 34 nên được schedule **sau Epic 22** (đang in-progress) nhưng **trước các epic 24-33** (consolidation, expansion) vì:
- Đo lường là điều kiện tiên quyết để biết scraper nào cần fix.
- Dữ liệu benchmark sẽ giúp ưu tiên Epic 27-32 (resilience, streaming, cost optimization).

**Next action:** Run `bmad-sprint-planning` để add Epic 34 vào sprint-status.yaml và gate readiness.

---

## Section 7 — Post-Review Changes Summary

| Change | Source | Status |
|--------|--------|--------|
| SPEC.md + metrics-catalog.md: Tier C = alert-only | All reviewers | Pending update |
| Add Story 34.7 (Canary Probes) | Test Architect | Added to v2 |
| Add Story 34.8 (Alerting & Re-qualification) | PM | Added to v2 |
| Hard knock-out gates in scoring formula | PM + Test Architect | Pending update to metrics-catalog.md |
| Two-tier storage architecture | Architect | Reflected in Story 34.1 description |
| Category-specific metric profiles | Test Architect | Pending update to metrics-catalog.md |
| Nowing consumer contract note | PM | Added to Section 5 |

---

*Document owner: BMad Product Council. Generated by bmad-correct-course v2 (post-review).*
