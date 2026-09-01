# Epic 6 Context: Facebook Anti-Detection & Bot Countermeasures

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tăng khả năng sống sót của automation Facebook bằng cách giả lập hành vi người thật và ẩn dấu hiệu automation: fingerprint nhất quán, navigator override, chuyển động chuột/hành vi tự nhiên, rate limiting, và quản lý session theo proxy/địa lý.

## Stories

- Story 6.1: Chrome executablePath Auto-Resolution (done in 5b.4)
- Story 6.2: Consistent Session Fingerprint
- Story 6.3: User-Agent Pool & Viewport Randomization
- Story 6.4: Navigator Properties Override
- Story 6.5: WebRTC Leak Prevention
- Story 6.6: Headless Mode Parameter (done in 5b.3)
- Story 6.7: Headless-Aware Timeouts (done in 5b.3)
- Story 6.8: Behavioral Delays in Share-Link-UID (done in 5b.2)
- Story 6.9: Bezier Mouse Movement
- Story 6.10: Human Click with Hover
- Story 6.11: Typing with Typos
- Story 6.12: Natural Scrolling
- Story 6.13: Action Velocity Limiting
- Story 6.14: Account Age Awareness
- Story 6.15: Session Warming Sequence
- Story 6.16: Timezone & Geolocation Override
- Story 6.17: Persistent Browser Profiles

## Requirements & Constraints

- Mỗi session phải có fingerprint (UA + viewport + hardware config) duy nhất và nhất quán trong suốt session.
- Phải override `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform` để tránh bị phát hiện automation.
- WebRTC phải bị vô hiệu hóa hoặc override để tránh rò rỉ IP thật.
- Chuyển động chuột phải theo đường cong Bezier, có micro-jitter, overshoot+correction, hoàn thành dưới 2s.
- Click phải có hover pause, mouse down/hold/up riêng biệt.
- Gõ phím phải có tốc độ biến đổi, typo 1-2%, pause sau dấu câu/từ.
- Scroll phải chia chunk, theo sin curve, có overshoot+correction.
- Mọi hành vi phải có injectable `delayFn` và `rng` seam để test nhanh và xác định.
- Không log cookie/token/fingerprint trong error hoặc response.
- Mọi module behavioral phải là pure module — không import puppeteer, nhận `page` làm tham số.

## Technical Decisions

- `fingerprint.js` quản lý UA pool, viewport, hardware config, và navigator overrides.
- `human.js` tập trung tất cả behavioral simulation: `humanMoveMouse`, `humanClick`, `humanType`, `humanScroll`.
- `limits.js` (nếu có) quản lý velocity limits và account-age scaling.
- `createPage(browser, { fingerprint })` sinh và áp fingerprint; hỗ trợ reuse fingerprint qua options.
- Delay floor cho Facebook cao hơn Twitter để tránh rate-limit (ADR-012).

## Cross-Story Dependencies

- Story 6.2, 6.3 phải hoàn thành trước 6.4 vì navigator override cần fingerprint đã có.
- Story 6.9 phải hoàn thành trước 6.10 vì `humanClick` reuse `humanMoveMouse`.
- Epic 6 là prerequisite cho Epic 7 (multi-account execution).
