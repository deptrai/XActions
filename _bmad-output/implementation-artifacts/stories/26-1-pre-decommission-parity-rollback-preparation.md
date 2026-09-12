---
title: 'Story 26.1: Pre-Decommission Parity & Rollback Preparation'
type: 'chore'
created: '2026-09-12'
status: 'done'
epic: 26
baseline_commit: '9ee24ac4c43ee0bc8c6978413247071f654b9d07'
context:
  - docs/decommission-plan-26.md
  - docs/deprecation-plan.md
  - src/scrapers/platforms.js
  - src/scrapers/social/index.js
  - package.json
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Story

As a **Reliability Engineer**,  
I want **một parity report đầy đủ cho các platform và kế hoạch an toàn/rollback trước khi xóa legacy code**,  
so that **việc decommission trong Story 26.2 diễn ra an toàn, có kiểm soát, và không gây regression cho bất kỳ consumer nào**.

## Intent

**Problem:** Việc xóa vĩnh viễn hơn 50 files và 15,000+ dòng code legacy (`src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/client/Scraper.js`...) trong Story 26.2 tiềm ẩn rủi ro phá vỡ các consumer cũ nếu thiếu kế hoạch rollback rõ ràng hoặc nếu tính năng hybrid chưa đạt 100% tương đương với legacy.

**Approach:** Thực hiện Stage 1 của Epic 26 (Safety & Rollback Shield):
1. Khảo sát toàn bộ danh mục file legacy cần xóa và xác định module thay thế tương đương (Parity Audit).
2. Thiết lập văn bản kế hoạch `docs/decommission-plan-26.md` với danh sách file, điều kiện rollback, thời hạn rollback (48h SLA), và hướng dẫn khôi phục từng bước.
3. Tạo git tag an toàn `pre-decommission-2026-09-12` từ `main`.
4. Rà soát trước các vị trí test có phụ thuộc vào file legacy để chuẩn bị cho Story 26.2.

## Boundaries & Constraints

**Always:**
- Không xóa bất kỳ file mã nguồn scraper nào trong Story 26.1 (việc xóa thuộc Story 26.2).
- Git tag `pre-decommission-2026-09-12` phải được tạo trên trạng thái code sạch, đã qua kiểm thử.
- Toàn bộ test suite (`npm test`) và typecheck (`npm run typecheck`) phải pass với 0 errors.

**Never:**
- Không được bypass git tag trước khi tiến hành decommission.
- Không sửa đổi logic nghiệp vụ trong `src/scrapers/social/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Git tag creation | Commit sạch trên `main` | Tag `pre-decommission-2026-09-12` được tạo | Throw nếu tag đã tồn tại hoặc repo dirty |
| Rollback trigger | Phát hiện lỗi trong 48h sau 26.2 | Khôi phục qua `git revert` hoặc checkout tag | Quy trình trong `docs/decommission-plan-26.md` |
| Parity check | Đối chiếu các action legacy vs hybrid | 100% action legacy có action hybrid tương đương | Báo cáo trong ma trận parity |

</frozen-after-approval>

## Code Map

- `docs/decommission-plan-26.md` -- Kế hoạch chi tiết, danh sách xóa, rollback SLA, ma trận parity.
- `docs/deprecation-plan.md` -- Tài liệu lộ trình deprecation của dự án.
- `_bmad-output/implementation-artifacts/epic-26-context.md` -- Context tài liệu của Epic 26.
- `package.json` -- Export map quản lý các subpaths cần chuyển đổi ở 26.2.

## Tasks & Acceptance

**Execution:**
- [x] `docs/decommission-plan-26.md` -- Soạn thảo kế hoạch decommission, danh sách xóa, SLA rollback 48h, quy trình revert.
- [x] `_bmad-output/implementation-artifacts/epic-26-context.md` -- Tạo context cho Epic 26.
- [x] `git tag` -- Tạo git tag `pre-decommission-2026-09-12` lưu trạng thái trước khi xóa code.
- [x] `npm run typecheck` & tests -- Đảm bảo chất lượng mã nguồn đạt chuẩn trước khi đóng Story 26.1.

**Acceptance Criteria:**
- Given Epic 23, 24, 25 done, when Story 26.1 hoàn tất, then `docs/decommission-plan-26.md` đã mô tả đầy đủ danh sách xóa và rollback conditions.
- Given nhánh `main`, when kiểm tra git tag, then `pre-decommission-2026-09-12` tồn tại và trỏ vào commit hợp lệ.
- Given toàn bộ repo, when chạy typecheck và tests, then 0 errors và 100% tests pass.

## Implementation Notes

- Đã lập tài liệu `docs/decommission-plan-26.md` chi tiết với danh mục >50 file sẽ xóa ở Story 26.2, quy trình rollback 48h, và chiến lược chuyển tiếp `package.json` exports.
- Đã phân tích tác động tới tests: xác định 5 test file kiểm tra `@deprecated` bằng `fs.readFile('src/client/Scraper.js')` cần được xử lý trong Story 26.2.
- Git tag `pre-decommission-2026-09-12` được tạo trên commit mới nhất.
