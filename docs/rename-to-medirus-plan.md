# Plan: Rename XActions → medirus

Quyết định đã chốt:
- Casing map: `XActions`→`Medirus`, `xActions`→`medirus`, `xactions`→`medirus`, `X_ACTIONS`→`MEDIRUS`, `x_actions`→`medirus_`, `x-actions`→`medirus-`
- Domain: `xactions.app`→`medirus.online`, `api.xactions.app`→`api.medirus.online`, `xactions.io`→`medirus.online`
- Breaking OK: storage keys, `window.XActions`, env vars `XACTIONS_*` đổi hết.
- GIỮ NGUYÊN: author `nichxbt`, `github.com/*/XActions` URLs (repo chưa rename trên GitHub), `bin/unfollowx`, thư mục `xspace-agents/`.

## Phase 0 — Dọn dẹp trước (bắt buộc)

1. Commit/stash working tree (đang có telegram changes chưa commit).
2. Xoá ~1.255 file ` (1).*` (iCloud conflict copies), **trừ `node_modules`** — ⚠️ **CẦN CONFIRM CỦA USER TRƯỚC KHI XOÁ** (rule §6). Quy trình an toàn, không `-delete` mù:
   ```bash
   # B1. Dry-run: so checksum từng dupe với file gốc cùng tên (bỏ " (1)")
   find . -name '* (1).*' -not -path './node_modules/*' -not -path './.git/*' -print0 |
     while IFS= read -r -d '' f; do
       orig="${f/ (1)./.}"
       if [ -f "$orig" ] && cmp -s "$f" "$orig"; then echo "IDENTICAL $f"
       else echo "DIFF-OR-ORPHAN $f"; fi
     done > /tmp/dupes-report.txt
   # B2. Chỉ xoá dòng IDENTICAL sau khi user duyệt report; DIFF-OR-ORPHAN review tay
   ```
   Lựa chọn an toàn hơn: `git clean`-style move vào `.trash-duplicates/` rồi xoá sau vài ngày, thay vì delete trực tiếp.
3. Verify build/test còn xanh sau khi dọn (dupe file có thể đang được import nhầm — hiếm nhưng check `rg " \(1\)"` trong import/require trước).

## Phase 1 — Replace content hàng loạt (script)

Script `scripts/rename-medirus.mjs`: đọc từng file text (skip `.git`, `node_modules`, binary `.png/.jpg/.ico/.pkl/.lock`), áp regex **theo thứ tự** (dài → ngắn, boundary-aware):

```js
// Thứ tự quan trọng — match dài nhất trước
const RULES = [
  [/api\.xactions\.app/g,            'api.medirus.online'],
  [/api\.xactions\.io/g,             'api.medirus.online'],
  [/xactions\.app/g,                 'medirus.online'],
  [/xactions\.io/g,                  'medirus.online'],
  [/X_ACTIONS(?=[_A-Z0-9]|\b)/g,     'MEDIRUS'],       // env vars
  [/xactions_/g,                     'medirus_'],       // storage keys
  [/x-actions/g,                     'medirus-'],
  [/XActions(?=[A-Z]|\b)/g,          'Medirus'],        // XActionsClient → MedirusClient
  [/(?<![A-Za-z])xActions/g,         'medirus'],        // (?<!...) bảo vệ maxActions!
  [/(?<![A-Za-z0-9_.\/-])xactions\b/g, 'medirus'],      // standalone; skip github URL path
];
```

Guard riêng cho URL: **không** replace `xactions` khi nằm trong `github.com/<user>/xactions` hoặc `github.com/<user>/XActions` — dùng negative lookbehind/lookahead hoặc whitelist-skip dòng chứa `github.com/nirholas/` và `github.com/deptrai/`… rồi review tay phần còn lại (docs nói về repo URL có thể muốn đổi text hiển thị nhưng giữ href).

Edge cases đã thống kê:
- `maxActions` / `CONFIG.maxActions` (~80 chỗ) — KHÔNG đụng (lookbehind).
- `xactionssettings`, `xactionsuser` (key nối liền) — rule riêng: `\bxactions(?=settings|user)` → `medirus`.
- `window.XActions*` — rule `XActions` cover được (`window.Medirus`, `window.MedirusToolbox`…).
- `org.xactions.scrape.completed` event names → `org.medirus.*` (rule `xactions.` boundary xử lý).
- `xActions` (n8n node name), `XActionsApi` credentials, `XActionsTrigger` → `medirus`, `MedirusApi`, `MedirusTrigger`.
- Lock files: sau replace, `package-lock.json`/`pnpm-lock.yaml` có field `name` cũ — chạy `npm install --package-lock-only` hoặc sed name field.

## Phase 2 — Rename file/dir có `xactions`/`XActions` trong tên

`git mv` (giữ history), case-sensitive 2 bước trên macOS (filesystem case-insensitive):
`git mv XActions x_tmp && git mv x_tmp medirus`.

Danh sách chính (~40 mục, generate bằng `find . -iname '*xactions*' -not -path './node_modules/*'`):
- `packages/xactions-mcp` → `packages/medirus-mcp` (+ sửa package.json name, bin, refs)
- `integrations/n8n/nodes/XActions/` → `Medirus/` (class `XActions.node.js` → `Medirus.node.js`, `XActionsApi.credentials.js` → `MedirusApi.credentials.js`)
- `skills/xactions-cli`, `skills/xactions-mcp-server`, `skills/xactions-test-engineer`
- `docs/xactions-reference.md`, `dashboard/docs/guides/xactions-reference.html`, `dashboard/docs/skills/xactions-*.html`
- `scripts/twitter/xactions-command-center.js`, `dashboard/scripts/xactions-command-center.html`, `dashboard/xactions-ascii.svg`, `.github/xactions-ascii.svg`
- `xactions-demo-*.png`, `.playwright-mcp/xactions-*.csv`, `_bmad-output/**/xactions-*` (~20 artifact dirs/files)
- File served `xactions.js` (CDN script ref `xactions.app/scripts/xactions.js`) → `medirus.js`

## Phase 3 — Config & package metadata (sửa tay, review kỹ)

- `package.json`: `name: "medirus"`, bins `medirus`, `medirus-mcp`, `medirus-agent`; homepage `medirus.online`; keywords thay `xactions`; giữ `unfollowx` bin.
- `packages/xactions-mcp/package.json` → `medirus-mcp` v3.x (major bump vì breaking).
- `wrangler.toml`: worker `name = "medirus"`.
- `railway.toml`, `fly.toml`, `vercel.json`, `deploy/gcp/cloudbuild-api.yaml`, `docker-compose*.yml`, `Dockerfile` labels, `.github/workflows/*` (image name, deploy target, sitemap URL).
- `public/sitemap.xml`, `dashboard/sitemap.xml`, `dashboard/docs/_sitemap-*.xml` — regenerate hoặc sed domain.
- `.github/repository-metadata.json`, `CODEOWNERS`, `copilot-instructions.md`.
- `bin/unfollowx` giữ nguyên tên file + shebang, chỉ đổi text `XActions` trong comments/logic.

## Phase 4 — Bề mặt breaking (đã duyệt)

- Env `XACTIONS_*` → `MEDIRUS_*` (~30 vars: SERVICE_KEYS, MCP_API_KEY, SESSION_COOKIE, API_TOKEN, MODE, BROWSER_POOL_SIZE, BROWSER_BACKEND, SCRAPER_ADAPTER, STOP, NO_TELEMETRY, VIDEO_URLS, VD_CAPTURED, DEFAULT_USERNAME, ARTIFACT_DIR, TEST_FAST_DELAYS…)
- Storage keys `xactions_*` → `medirus_*` (~50 keys)
- `window.XActions*` → `window.Medirus*`
- Class/function exports: `XActionsClient`, `XActionsUtils`, `XActionsOptions`, `xactionsClient`, `stopXActionsMonitor`…
- `.env.example`, docs env tables, CI secrets (`.github/workflows` dùng `secrets.XACTIONS_*` → cần đổi tên secret trên GitHub UI sau).

## Phase 5 — Verify

```bash
rg -i 'xactions|x.actions' --hidden --glob '!.git' --glob '!node_modules' \
  | grep -v 'github.com/nirholas\|github.com/deptrai\|nichxbt'   # kỳ vọng ~0
npm test          # suite hiện tại
npm run build / deploy dry-run nếu có
```

Checklist tay: CLI `npx medirus --help` (link global sau `npm i -g .`), MCP server `medirus-mcp`, dashboard title, sitemap domain, n8n node load.

## Thứ tự thực thi đề xuất

1. Phase 0 (commit + xoá dupe) → commit riêng "chore: remove iCloud conflict copies"
2. Phase 2 (rename file/dir trước — tránh conflict khi sửa content sau)
3. Phase 1 (bulk content replace) → 1 commit
4. Phase 3+4 (config tay) → 1 commit
5. Phase 5 verify → fix lẻ
6. (Ngoài repo, sau): rename GitHub repo → update `github.com/*/XActions` URLs; đổi npm package (deprecate `xactions`, publish `medirus`); trỏ domain medirus.online; đổi secrets CI.
