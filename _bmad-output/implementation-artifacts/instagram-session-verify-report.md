# Instagram Session Verification Report (Story 35.5)

**Status: ⏳ PENDING OPERATOR RUN** — script ready, awaiting credentials.

## Prerequisites (AC-1) — operator checklist

- [ ] `IG_TEST_SESSIONID` (hoặc `IG_TEST_USER` + `IG_TEST_PASS`) trong env — non-production account
- [ ] `PROXY_URL` — stable residential proxy (`country-us` preferred, KHÔNG `country-vn`)
- [ ] Optional: `IG_TEST_DS_USER_ID`, `IG_TEST_CSRFTOKEN`, `IG_VERIFY_REQUESTS` (default 12)

## Run

```bash
node scripts/verify-instagram-session.mjs
```

Script tự: establish session (AC-2) → chạy 12 request tuần tự mix `user`/`hashtag` với
gaussian delay 1–3s (AC-3) → test `loadSession` không re-login (AC-4) → ghi report này
với verdict PASS/FAIL + request log (AC-5) → nếu gặp challenge, ghi contingency
khuyến nghị (AC-6) và dừng run.

## Results

_(điền sau khi chạy — script ghi đè phần này với bảng request log + verdict)_
