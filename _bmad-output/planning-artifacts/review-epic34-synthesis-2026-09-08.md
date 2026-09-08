# Tổng Hợp Review Epic 34 — Scraper Benchmark & Reliability Suite

## Nguồn Review
- **John (BMad PM)** — Product Manager perspective
- **Winston (BMad Architect)** — System Architecture perspective  
- **Murat (BMad Test Architect)** — Test Strategy & NFR validation
- *(Amelia/Dev và Mary/Analyst agents không trả về output — có thể do timeout hoặc lỗi)*

---

## 1. Điểm Mạnh (Consensus)

| PM | Architect | Test Architect |
|---|---|---|
| Strategic alignment với bottleneck cốt lõi | Tuân thủ hexagonal architecture + AD-1..AD-22 | Comprehensive ATDD scenarios cho tất cả 6 stories |
| Metrics catalog exhaustive, thresholds hợp lý | Component topology rõ ràng (TelemetryEmitter, Validator, ScoringEngine, HealthCache) | 5-layer test pyramid đầy đủ |
| Additive footprint — không phá vỡ code hiện có | Data flow: Redis Stream → Worker → PostgreSQL | Traceability matrix đầy đủ |
| Tier A/B/C mental model rõ ràng | Zero modification needed cho platform crawlers | Defensive tactics cho 5 risk hotspots |

---

## 2. Vấn Đề Quan Trọng (Critical Issues)

### 2.1. Mâu Thuẫn Spec vs. Proposal (PM + Architect + Test Architect đều flag)

| Vấn đề | Chi tiết |
|--------|----------|
| **SPEC.md** (CAP-4, Success Signal) | "Tier C scrapers are automatically gated from Nowing ingestion" |
| **metrics-catalog.md** (Tier Classification) | "auto-gate from Nowing ingestion until re-qualified" |
| **Change Proposal** (Section 1, Story 34.6, FR-101) | "Tier C scrapers trigger operator alerts only (human-in-the-loop)" |
| **Memlog** | "RESOLVED Q1: Tier C scrapers trigger operator alerts only" |

**Hậu quả:** Acceptance tests cho Story 34.6 không thể có assertion rõ ràng. Testing auto-stop phá vỡ product decision; bỏ qua auto-stop vi phạm spec.

**Khuyến nghị:** Cập nhật SPEC.md + metrics-catalog.md để align với quyết định của Luisphan (alert-only, không auto-cutoff).

### 2.2. Thiếu Story cho CAP-1 (Test Architect)

- **CAP-1** (Synthetic Canary Probes) được định nghĩa trong SPEC.md nhưng **không có story nào** trong proposal implement nó.
- **Hậu quả:** Low-volume scrapers (Masothue, Muasamcong) có thể không có production data → scoring engine divide-by-zero hoặc stale scores.
- **Khuyến nghị:** Thêm **Story 34.7** (Synthetic Canary Probe Scheduler) hoặc merge vào 34.2/34.4.

### 2.3. Công Thức Scoring Chưa Hoàn Thiện (PM + Test Architect)

| Vấn đề | Chi tiết |
|--------|----------|
| **Compensatory masking** | Linear weighted average cho phép scraper "chết" vẫn đạt Tier B (ví dụ: Stability=100%, Quality=95%, Cost=90% → Score~75 dù Contact Accuracy=0%) |
| **Missing normalization** | Không có mapping từ raw metrics (ms, MB, %) sang 0-100 pillar score |
| **N/A field handling** | `comment_completeness` không áp dụng cho directory/registry scrapers → division by zero hoặc unfair penalty |
| **Zero-record edge case** | `field_fill_rate` và `proxy_bytes/records` crash khi 0 records |

**Khuyến nghị:**
- Thêm **hard knock-out gates**: `True Success < 80%` OR `Field Fill < 85%` → cap tại Tier C
- Dynamic weighting: metrics N/A được loại khỏi denominator, weights re-normalized
- `safeRatio()` utility với fallback cho division-by-zero

### 2.4. Database Write Amplification (Architect)

- **Vấn đề:** Story 34.1 đề xuất ghi `ScraperBenchmarkRun` trực tiếp vào PostgreSQL mỗi scrape run → massive write amplification, pool contention.
- **Giải pháp:** Two-tier architecture:
  - **Tier 1:** Redis Stream `stream:benchmark:telemetry` (raw, 7-day TTL, MAXLEN ~500k)
  - **Tier 2:** PostgreSQL `ScraperHealthScore` (aggregated hourly/daily rollups only)

### 2.5. Latency Overhead Risk (Architect + Test Architect)

- **NFR-19:** < 1% latency overhead — fast scrapers (50-200ms) chỉ cho phép **0.5-2.0ms** telemetry budget.
- **Giải pháp:** Fire-and-forget `setImmediate`, in-memory ring buffer, batch flush to Redis. Không bao giờ block return path.

### 2.6. Overlap với Epic 27-28 (PM)

- Story 34.3 (Platform Validators) trùng `28-2-selector-canary`, `28-1-schema-drift-guard`, `27-3-challenge-signature-detector`.
- **Khuyến nghị:** Phase Epic 34 — Phase 1 (MVP) tách biệt measurement, Phase 2 merge với Epic 27/28.

---

## 3. Missing / Cần Bổ Sung

| Item | Người flag | Chi tiết |
|------|-----------|----------|
| **Active alerting** | PM | Không có Slack/Telegram/Webhook push — passive dashboard không đủ cho human-in-the-loop ngoài giờ |
| **Re-qualification workflow** | PM | Không định nghĩa bao nhiêu canary runs sạch để promote từ C → B → A |
| **Nowing consumer contract** | PM | Story 34.6 thêm `benchmark_health` nhưng Nowing chưa có logic consume → zero business value |
| **Telemetry granularity** | PM | Không phân biệt per-run vs per-item sampling → có thể vi phạm NFR-19 |
| **Normalization appendix** | Test Architect | Cần mapping function raw metric → 0-100 score |
| **Category-specific metric profiles** | Test Architect | Social vs directory vs ecommerce có metric sets khác nhau |

---

## 4. Kiến Trúc Đề Xuất (Architect)

### Components
1. `src/core/telemetry-emitter.js` — non-blocking collector
2. `src/core/platform-validator.js` — False-200 detection extensions
3. `src/services/benchmark-scoring-engine.js` — scheduled aggregation worker
4. `src/utils/redis-stream-publisher.js` — health tier cache O(1)

### Data Flow
```
AbstractCrawler.start() → AbstractApiClient.request() → [telemetry]
                                    ↓
                    Redis Stream: stream:benchmark:telemetry (fire-and-forget)
                                    ↓
                    Bull Worker / Daemon Timer → aggregate → PostgreSQL
                                    ↓
                    Redis Hash: hash:scraper:health_tier → thin events
```

### Prisma Schema (đề xuất)
```prisma
model ScraperHealthScore {
  id               String   @id @default(cuid())
  scraperId        String
  platform         String
  healthScore      Float
  tier             String   // 'A' | 'B' | 'C'
  stabilityScore   Float
  qualityScore     Float
  noiseScore       Float
  costScore        Float
  sampleCount      Int      @default(0)
  evaluatedAt      DateTime @default(now())
  metricsSnapshot  Json
  @@index([platform, evaluatedAt(sort: Desc)])
  @@index([scraperId, evaluatedAt(sort: Desc)])
}

model ScraperCanaryRun {
  id              String   @id @default(cuid())
  scraperId       String
  platform        String
  targetUrl       String
  isSuccess       Boolean
  latencyMs       Int
  httpStatus      Int
  false200Detected Boolean  @default(false)
  checkpointDetected Boolean @default(false)
  errorReason     String?
  executedAt      DateTime @default(now())
  @@index([platform, executedAt(sort: Desc)])
}
```

---

## 5. Test Strategy (Test Architect)

### 5-Layer Test Pyramid
| Layer | Mục tiêu | File |
|-------|----------|------|
| L1: Unit & Math | Formulas, edge cases, div/0, tiers | `tests/benchmark/scoring-engine.test.js` |
| L2: Platform Validators | False-200 fixtures, dual signatures | `tests/benchmark/platform-validators.test.js` |
| L3: Integration | Redis Stream → Worker → Prisma | `tests/benchmark/telemetry-pipeline.test.js` |
| L4: Performance/NFR | NFR-19 (<1%), NFR-20 (<500ms) | `tests/benchmark/nfr-performance.test.js` |
| L5: E2E Nowing | Thin event + health flag + alert | `tests/benchmark/nowing-integration.test.js` |

### Risk Hotspots
1. **Telemetry overhead** — async dispatch, circuit breaker, drop-if-buffer-full
2. **False 200 loopholes** — skeleton HTML detection, structural markers
3. **Division-by-zero** — `safeRatio()` utility
4. **Missing metrics** — category-specific profiles, dynamic weighting
5. **Nowing contract drift** — JSON schema validation, dual signal (`benchmark_health` + `benchmark_alert`)

---

## 6. Khuyến Nghị Tổng Hợp

### PM (John)
1. **Reconcile gating policy** — Hard circuit breaker cho True Success <50% hoặc False 200 >15%; soft alerts cho degradation nhẹ.
2. **Phase Epic 34** — Phase 1 (MVP): Stories 34.1, 34.2, 34.4; Phase 2 (Hardening): 34.3 merged với Epic 27/28 + alerting.
3. **Revise formula** — Hard knock-out gates cho critical metrics.
4. **Sequencing** — Epic 34 sau Epic 22, trước Epic 33 và Epic 20.

### Architect (Winston)
1. **Update SPEC.md + metrics-catalog.md** để align với alert-only decision.
2. **Two-tier storage** — Redis Stream raw + PostgreSQL aggregated.
3. **Centralize hooks** — Telemetry trong `AbstractCrawler`/`AbstractApiClient`, không touch platform crawlers.
4. **Add AD-23** — Two-Tier Benchmark Architecture vào ARCHITECTURE-SPINE.md.

### Test Architect (Murat)
1. **Resolve spec conflict** — Update SPEC.md line 33, metrics-catalog.md line 75.
2. **Add Story 34.7** — Synthetic Canary Probe Scheduler cho CAP-1.
3. **Formalize normalization** — Appendix trong metrics-catalog.md.
4. **Enforce ATDD** — Scaffold `tests/benchmark/` trước khi dev implement.

---

## 7. Action Items Cho Luisphan

| # | Hành động | Ưu tiên | Effort |
|---|-----------|---------|--------|
| 1 | Cập nhật SPEC.md + metrics-catalog.md: Tier C = alert-only (không auto-gate) | **P0** | 5 phút |
| 2 | Thêm Story 34.7 (Canary Probe Scheduler) vào proposal | **P0** | 10 phút |
| 3 | Thêm normalization appendix vào metrics-catalog.md | **P1** | 15 phút |
| 4 | Thêm hard knock-out gates vào scoring formula | **P1** | 10 phút |
| 5 | Cập nhật proposal: two-tier storage architecture | **P1** | 10 phút |
| 6 | Thêm Nowing consumer contract note | **P2** | 5 phút |
| 7 | Thêm alerting mechanism (Slack/Telegram/Webhook) | **P2** | 10 phút |
| 8 | Thêm re-qualification workflow | **P2** | 10 phút |

---

*Generated by Mary (BMad Analyst) — synthesizing PM, Architect, and Test Architect reviews.*
