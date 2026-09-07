# Epic 11 Retrospective: Resilient Network & Proxy Pool Management

Status: done  
Date: 2026-09-08

## Summary

Epic 11 xây dựng **proxy pool management** và **rate-limit/governor system** — nền tảng networking cho toàn bộ XActions. Gồm 9 stories từ sticky round-robin proxy đến dual-pool consumer quota.

Epic complete across nine stories:

| Story | Status | Outcome |
|---|---|---|
| 11.1 ProxyIpPool + AccountPool | done | Sticky round-robin, proxy rotation, account binding |
| 11.2 Static/Dynamic/Residential/Tunnel Providers | done | Multi-provider proxy support |
| 11.3 429/403 Auto-Quarantine & Backoff | done | Exponential backoff, quarantine, replay interceptor |
| 11.4 Adaptive Infrastructure-Aware Rate Limiter | done | `AdaptiveRateGovernor` |
| 11.5 End-to-End Request Pipeline | done | Two-mode IP (realtime/bulk) |
| 11.6 Rate-Limit & Bot-Challenge Defense | done | Bot challenge detection, `XACT_4291`/`XACT_5030` |
| 11.7 Crawler-Governor Integration | done | Validator contract, governor integration |
| 11.8 SocksNode Dynamic Residential Provider | done | `SocksNode` provider integration |
| 11.9 Dual-Pool Consumer Quota | done | Realtime/bulk pool partitioning, consumer quotas, `XACT_4010` |

Final verification: **tests/core/base-client-dual-pool.test.js, tests/proxy/dual-pool-proxy.test.js, tests/mcp/mcp-consumer-quota.test.js** pass.

**~2023 lines added in 11.9 commit alone**, plus previous 11.1-11.8 work.

## What Went Well

1. **ProxyIpPool design scalable**
   - 30/70 realtime/bulk index partitioning.
   - `getProxy`/`getRealtimeProxy`/`getBulkProxy` tự động infer pool.
   - Sticky bindings cho account consistency.

2. **AdaptiveRateGovernor consumer quota**
   - Sliding-window quotas per consumer: chainlens 10 RPM, nowing 60 RPM, internal Infinity.
   - `recordConsumerRequest`/`getConsumerRetryAfterSeconds`.
   - Quota rollback on pre-flight failure.

3. **MCP integration**
   - `identifyConsumer` middleware + `AsyncLocalStorage`.
   - `XACT_4010` quota errors, `XACT_4291` rate-limit, `XACT_5030` bot challenge.

4. **Dual-pool test coverage**
   - `base-client-dual-pool.test.js` (160+ lines) cover pool selection.
   - `mcp-consumer-quota.test.js` (237 lines) cover MCP quota gating.

## What Was Difficult

1. **Story 11.3 review loop**
   - Tests dùng `vi.fn()` mocks — vi phạm no-mock rule.
   - No-auth request tracking missing.
   - Phải move từ `review` về `in-progress`.

2. **Rate-governor + proxy interaction phức tạp**
   - Consumer quota gate phải chạy trước account gate.
   - Proxy resolve record sau khi quota pass.
   - Cần `recordConsumerRequest` rollback khi proxy resolve fail.

3. **Type alignment nhiều file**
   - `src/core/types.js`, `types/core.d.ts`, `types/proxy.d.ts`, `src/proxy/proxy-pool.d.ts` cần sync.
   - `PoolName`, `DualPoolStats`, `ConsumerQuotaConfig`, `ConsumerStatus`.

## Key Decisions

1. **Dual-pool realtime/bulk**
   - Realtime pool cho MCP/CLI requests.
   - Bulk pool cho batch crawls.
   - Consumer infer pool từ request context.

2. **Proxy + account quarantine**
   - Proxy bị quarantine khi 429/403 nhiều lần.
   - Account bị quarantine khi auth fail hoặc rate limit.
   - `quarantineProxy`/`quarantineAccount` trong admin CLI.

3. **Consumer identity ở MCP layer**
   - `Bearer` token identify consumer.
   - `AsyncLocalStorage` propagate consumer context xuống governor.

## Follow-up Recommendations

1. **Real proxy integration tests**
   - Mock tests pass nhưng cần test với real SocksNode/proxy provider.

2. **Dynamic quota adjustments**
   - Hiện quota là static config — có thể cần adaptive dựa trên provider limit.

3. **Pool stats dashboard**
   - `getPoolStats` expose realtime/bulk stats — có thể show trên dashboard.

## Final State

- Epic 11 status: **done**
- All nine stories: **done**
- Retrospective: **done**
- Rate-limit/proxy foundation ready cho Epic 21/22
