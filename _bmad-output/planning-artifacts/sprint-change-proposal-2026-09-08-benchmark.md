---
title: "Sprint Change Proposal — Epic 34: Scraper Benchmark & Reliability Suite"
date: 2026-09-08
status: draft
scope: major
---

# Sprint Change Proposal

**Date:** 2026-09-08  
**Project:** XActions  
**Triggering issue:** Sau khi phân tích chiến lược với Mary (BMad Analyst), Luisphan quyết định ưu tiên xây dựng **Benchmark tiêu chuẩn đo lường độ ổn định, chất lượng, độ nhiễu, chi phí** của tất cả scraper trước khi phát triển thêm tính năng mới. Đây là điều kiện tiên quyết để đảm bảo Nowing nhận được dữ liệu đáng tin cậy.

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

---

## Section 2 — Proposed Change

### New Epic: Epic 34 — Scraper Benchmark & Reliability Suite

**Mục tiêu:** Xây dựng hệ thống đo lường 4-trục (Stability, Quality, Noise, Cost) để chấm điểm sức khỏe mọi scraper trong XActions.

**Spec reference:** `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` + `metrics-catalog.md`

### Epic 34 Stories

| Story | Title | Mô tả | Dependencies |
|-------|-------|-------|-------------|
| **34.1** | Benchmark Telemetry Schema & Storage | Định nghĩa Prisma model `ScraperBenchmarkRun`, `ScraperHealthScore`; Redis Stream `stream:benchmark:telemetry` | Epic 10.2 (Prisma schema), Epic 10.5 (Metadata registry) |
| **34.2** | Production Telemetry Hooks in AbstractCrawler | Thêm telemetry emission vào `AbstractCrawler.start()`, `BaseApiClient.request()` — ghi field-fill rate, latency, proxy bytes, schema validation, duplicate detection | Epic 10.1 (AbstractCrawler), Epic 13-18 (all crawlers) |
| **34.3** | Platform-Specific Validators & False-200 Detection | Mở rộng `AbstractPlatformResponseValidator` để detect Cloudflare/Arkose/login-wall/empty-page cho từng platform | Epic 11.6 (validator contract), per-platform scrapers |
| **34.4** | Benchmark Scoring Engine | Cron job tính Health Score (0-100) theo công thức 0.35×Stability + 0.30×Quality + 0.20×Noise + 0.15×Cost; classify Tier A/B/C | 34.1, 34.2, 34.3 |
| **34.5** | Operator Scorecard CLI & Dashboard | CLI `xactions benchmark` (list, run, history, platform detail); dashboard health matrix trong `dashboard/admin.html` | 34.4, Epic 19 (dashboard) |
| **34.6** | Nowing Integration: Health Flag in Stream Events | Thêm `benchmark_health: "A" | "B" | "C"` vào thin event payload gửi Nowing; Nowing có thể filter hoặc flag theo tier | 34.4, Epic 14.3 (stream emit) |

### New Functional Requirements

| FR | Title | Mô tả |
|----|-------|-------|
| **FR-98** | Scraper Benchmark Telemetry | Hệ thống phải emit structured telemetry cho mọi scrape run: true_success, latency_ms, field_fill_rate, schema_valid, proxy_bytes, duplicate_flag, contact_valid |
| **FR-99** | Benchmark Scoring Engine | Cron job tính Health Score per scraper per platform theo công thức weighted 4-pillar; lưu vào `ScraperHealthScore` |
| **FR-100** | Operator Benchmark CLI & Dashboard | `xactions benchmark` command và dashboard view hiển thị Tier A/B/C, trend, drill-down metrics |
| **FR-101** | Nowing Health Flag | Thin event payload thêm `benchmark_health` field; Nowing có thể filter hoặc alert theo tier |

### New Non-Functional Requirements

| NFR | Title | Mô tả |
|-----|-------|-------|
| **NFR-19** | Benchmark Overhead | Telemetry emission phải < 1% latency overhead và < 5% memory overhead trên mỗi scrape run |
| **NFR-20** | Benchmark Data Retention | Raw telemetry TTL 7 ngày; aggregated scores giữ 90 ngày; dashboard query < 500ms |

---

## Section 3 — Impact Analysis

### Epic Impact

| Epic | Impact | Required change |
|------|--------|---------------|
| **Epic 10** | Minor | Thêm `ScraperBenchmarkRun`, `ScraperHealthScore` models vào Prisma schema |
| **Epic 11** | Minor | Thêm proxy bandwidth tracking vào `AbstractApiClient` |
| **Epic 13-18** | Moderate | Thêm telemetry emission vào mỗi crawler (1-2 lines per platform) |
| **Epic 14** | Minor | Thêm `benchmark_health` vào thin event payload |
| **Epic 19** | Moderate | Thêm benchmark dashboard view và CLI commands |
| **Epic 20** | None | Decommission không ảnh hưởng |
| **Epic 27-32** | None | Các epic tương lai sẽ benefit từ benchmark data |

### Story Impact

| Story | Change needed |
|-------|-------------|
| 10.2 | Thêm models `ScraperBenchmarkRun`, `ScraperHealthScore` |
| 10.5 | Thêm benchmark telemetry schema vào `MetadataSchemaRegistry` |
| 11.3 | Thêm proxy byte counting vào request pipeline |
| 13.x-18.x | Thêm `this.emitTelemetry()` call trong `AbstractCrawler` hoặc từng crawler |
| 14.3 | Thêm `benchmark_health` field vào stream payload |
| 19.x | Thêm benchmark dashboard section và CLI commands |

### Artifact conflicts

| Artifact | Conflict / update needed |
|----------|--------------------------|
| **PRD** `prd.md` | Append FR-98..FR-101, NFR-19, NFR-20 |
| **Epics** `epics.md` | Append Epic 34 với 6 stories |
| **Sprint Status** `sprint-status.yaml` | Thêm Epic 34 và stories vào backlog |
| **Architecture** `ARCHITECTURE-SPINE.md` | Thêm component `BenchmarkEngine` và `TelemetryEmitter` |

---

## Section 4 — Recommended Approach

**Direct Adjustment** — append Epic 34 vào backlog; không rollback hay restructure epic hiện có.

**Rationale:**
- Epic 34 là additive: không thay đổi logic scraper hiện có, chỉ thêm measurement layer.
- Tất cả platform scrapers (Epic 13-18, 21-22, 33) sẽ benefit từ benchmark ngay khi được implement.
- Có thể chạy song song với các epic đang in-progress (Epic 22) vì không conflict.

**Effort estimate:**
- 34.1 (Schema): 0.5 sprint
- 34.2 (Telemetry hooks): 1 sprint (touch all crawlers)
- 34.3 (Validators): 1-2 sprints (per-platform tuning)
- 34.4 (Scoring): 0.5 sprint
- 34.5 (CLI/Dashboard): 1 sprint
- 34.6 (Nowing flag): 0.5 sprint
- **Total: 3-4 sprints**

**Risk:** Low — telemetry là side-car, không block main flow. Có thể toggle off nếu có vấn đề.

---

## Section 5 — Handoff

| Role | Responsibility |
|------|---------------|
| **Winston (Architect)** | Review Epic 34 stories, define `TelemetryEmitter` interface, decide Redis Stream vs. Prisma for raw telemetry |
| **Amelia (Dev)** | Implement stories 34.1-34.6 in order; start with 34.1 schema + 34.2 hooks |
| **Mary (Analyst)** | Validate metrics catalog thresholds with Nowing team; confirm Tier A/B/C boundaries |
| **John (PM)** | Prioritize Epic 34 trong sprint planning; decide if it blocks or parallels Epic 22 |

---

## Section 6 — Approval & Next Steps

**Proposed priority:** Epic 34 nên được schedule **sau Epic 22** (đang in-progress) nhưng **trước các epic 24-33** (consolidation, expansion) vì:
- Đo lường là điều kiện tiên quyết để biết scraper nào cần fix.
- Dữ liệu benchmark sẽ giúp ưu tiên Epic 27-32 (resilience, streaming, cost optimization).

**Next action:** Run `bmad-sprint-planning` để add Epic 34 vào sprint-status.yaml và gate readiness.

---

*Document owner: BMad Product Council. Generated by bmad-correct-course.*
