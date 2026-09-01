---
title: 'Story 6.4: Human Physics Easing Motion Curves'
type: 'feature'
created: '2026-09-01'
baseline_commit: '7a14c3367f78eb1f0835e337e53e8d3ef93df75f'
status: 'done'
review_loop_iteration: 0
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - src/scrapers/facebook/human.js
  - tests/scrapers/facebook-human.test.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `humanMoveMouse` hiện dùng cubic Bezier cố định từ Story 6.9. Mặc dù đã có micro-jitter và overshoot, quỹ đạo chuột vẫn là đường cong toán học đơn thuần, chưa mô phỏng đầy đủ động lực học của cử chỉ người thật (tăng tốc ban đầu, giảm tốc khi đến đích, và "trôi" tự nhiên qua mục tiêu).

**Approach:** Thay thế kernel di chuyển của `humanMoveMouse` bằng hệ thống easing dựa trên vật lý (physics-based easing), tách rõ giai đoạn tăng tốc → giữ tốc → giảm tốc, đảm bảo vẫn dưới 2 giây và giữ nguyên các seam `delayFn`/`rng` hiện có.

## Boundaries & Constraints

**Always:**
- `src/scrapers/facebook/human.js` vẫn là pure module, không import puppeteer.
- Tổng thời gian di chuyển dưới 2 giây (NFR1).
- Các seam `delayFn` và `rng` vẫn hoạt động như cũ (NFR3).
- Không log tọa độ/fingerprint trong error message (NFR4).
- Không phá vỡ API `humanMoveMouse(page, x, y, { delayFn, rng, startX, startY })` đã có.
- Không ảnh hưởng `humanClick`, `humanType`, `humanScroll`.

**Ask First:**
- Nếu cần thêm dependency easing bên ngoài (npm package) thay vì implement nội bộ.
- Nếu muốn bỏ hoàn toàn cubic Bezier thay vì giữ lại như một strategy option.

**Never:**
- Không thay đổi UA pool, fingerprint, navigator overrides, WebRTC, hoặc các behavioral function khác.
- Không thêm Puppeteer dependency vào `human.js`.
- Không thay đổi `tests/helpers/fake-page.js` ngoài việc bổ sung nếu cần (đã đủ `mouse.move`).

</frozen-after-approval>

## Code Map

- `src/scrapers/facebook/human.js` — module behavioral chính, cần thay kernel `cubicBezier` + loop chuyển động bằng physics-based easing.
- `src/scrapers/facebook/human.js:81-84` — `cubicBezier` helper — có thể tái dùng hoặc thay bằng easing physics.
- `src/scrapers/facebook/human.js:109-191` — `humanMoveMouse` body — nơi cần đổi logic quỹ đạo.
- `tests/scrapers/facebook-human.test.js` — tests `humanMoveMouse`; cần thêm test velocity profile.
- `tests/helpers/fake-page.js` — fake `page.mouse.move` đã ghi nhận `{ x, y, opts }`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/scrapers/facebook/human.js` -- thay kernel di chuyển của `humanMoveMouse` từ cubic Bezier sang physics-based easing curve, giữ nguyên micro-jitter ±2px, overshoot 15%, correction phase, và các seam `delayFn`/`rng`.
- [ ] `src/scrapers/facebook/human.js` -- tách rõ 3 phase: ease-in (tăng tốc), coast (duy trì), ease-out (giảm tốc) để velocity profile giống cử chỉ người thật.
- [ ] `src/scrapers/facebook/human.js` -- giữ số bước 20-35, tổng thời gian dưới 2s, và jitter per step ±2px.
- [ ] `tests/scrapers/facebook-human.test.js` -- thêm test velocity profile (bước đầu nhỏ, giữa lớn, cuối nhỏ) với deterministic `rng`.
- [ ] `tests/scrapers/facebook-human.test.js` -- thêm test overshoot + correction vẫn hoạt động với physics easing.

**Acceptance Criteria:**
- Given `humanMoveMouse(page, 500, 300)`, when hoàn tất, then `page.mouse.move` được gọi 20-35 lần và vị trí cuối nằm trong target ±2px jitter.
- Given `rng` xác định, when so sánh quỹ đạo, then step distances thể hiện giai đoạn tăng tốc/giảm tốc.
- Given `delayFn: async () => {}`, when thực thi, then tổng thời gian dưới 2 giây.
- Given `x` hoặc `y` không finite, when gọi `humanMoveMouse`, then throw generic error trước khi gọi `mouse.move`.
- Given `human.js` đã sửa, when chạy `vitest run tests/scrapers/facebook-human.test.js`, then tất cả tests cũ + mới pass.

## Spec Change Log

## Design Notes

- Dùng `physicsEase(t)` điều khiển tốc độ dọc theo quỹ đạo: bước đầu nhỏ (ease-in), giữa lớn (coast), cuối nhỏ (ease-out). Ví dụ smooth-step bậc 5: `t * t * t * (t * (t * 6 - 15) + 10)`.
- Giữ nguyên cơ chế 2 control points perpendicular với vector `start→target` để quỹ đạo không gian vẫn cong tự nhiên.
- Jitter ±2px và overshoot 15% (clamp 1-25px) giữ nguyên; correction phase 3-5 bước trở về target thật.
- Delay per step giữ 15-40ms randomized để đảm bảo tổng thời gian <2s.

## Verification

**Commands:**
- `vitest run tests/scrapers/facebook-human.test.js` -- expected: all tests pass.
- `vitest run tests/scrapers/facebook-fingerprint.test.js` -- expected: all tests pass (no regression).
- `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` -- expected: all tests pass (no regression).

## Suggested Review Order

**Core behavioral change**

- New `physicsEase` helper that produces 5th-order smoothstep easing.
  [`human.js:97`](../../src/scrapers/facebook/human.js#L97)

- Main loop applies `physicsEase` to the Bezier parameter to shape velocity.
  [`human.js:185`](../../src/scrapers/facebook/human.js#L185)

- Overshoot correction phase now uses the same easing for a natural ease-out.
  [`human.js:199`](../../src/scrapers/facebook/human.js#L199)

- Module header and JSDoc updated to document the new `Story 6.4` scope.
  [`human.js:16`](../../src/scrapers/facebook/human.js#L16)

**Test coverage**

- Velocity profile test: first and last steps smaller than middle steps.
  [`facebook-human.test.js:189`](../../tests/scrapers/facebook-human.test.js#L189)

- Overshoot still corrects back to target with deterministic RNG.
  [`facebook-human.test.js:215`](../../tests/scrapers/facebook-human.test.js#L215)

- Short 3px movement still reaches target despite eased stepping.
  [`facebook-human.test.js:740`](../../tests/scrapers/facebook-human.test.js#L740)

- Sanity test that eased output is finite and lands on target.
  [`facebook-human.test.js:748`](../../tests/scrapers/facebook-human.test.js#L748)
