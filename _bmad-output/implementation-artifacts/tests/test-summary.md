# Test Automation Summary — Story 10.4

## Tính năng được test

CrawlCheckpoint Operational API (Resume / Pause / Retry):

- `GET /api/checkpoints`
- `GET /api/checkpoints/:id`
- `POST /api/checkpoints/:id/resume`
- `POST /api/checkpoints/:id/pause`
- `POST /api/checkpoints/:id/retry`
- `xactions checkpoints list|show|resume|pause|retry`

## Test framework

- **Vitest 4.x** + **supertest**
- Real PostgreSQL (test DB `xactions_test`)
- Real Express app (`api/server.js`)
- Real CLI binary (`node src/cli/index.js`)

## File test đã tạo/sửa

### API E2E
- `tests/e2e/api-checkpoints.test.js` — 10 test cases

### CLI E2E
- `tests/cli/checkpoints-cli.test.js` — 8 test cases

### Sửa đổi hỗ trợ E2E
- `src/cli/index.js`:
  - Gỡ bỏ lệnh `scrape` trùng lặp (gây crash CLI).
  - Gộp lệnh `ai` trùng lặp thành một command group duy nhất (`ai write`).
  - Thêm validate `--limit`/`--offset` và JSON error envelope cho `checkpoints`.

## Kết quả chạy test

### E2E chuyên sâu Story 10.4
```
npx vitest run tests/e2e/api-checkpoints.test.js tests/cli/checkpoints-cli.test.js
```
- **Test files:** 2 passed
- **Tests:** 18 passed

### Toàn bộ test suite
```
npx vitest run
```
- **Test files:** 156 passed | 2 failed | 3 skipped
- **Tests:** 3747 passed | 5 failed | 54 skipped
- **Thời gian:** ~566s

### Các lỗi còn lại
5 failures nằm trong `tests/scrapers/facebook-index.test.js` và `tests/scrapers/facebook-posts.test.js`, không liên quan đến Story 10.4 và tồn tại trước khi tạo E2E test.

## Coverage

- **API endpoints:** 5/5 checkpoint endpoints covered
- **CLI commands:** 5/5 checkpoint subcommands covered
- **Auth channels:** JWT admin, A2A API key, A2A Bearer token
- **Error cases:** 401, 403, 404, 400 illegal transition, invalid pagination

## Next steps

- Kiểm tra 5 failures pre-existing trong scraper tests.
- Chạy E2E test trong CI với `DATABASE_URL` trỏ đến test DB.
- Bổ sung E2E cho các story tiếp theo (10.5).
