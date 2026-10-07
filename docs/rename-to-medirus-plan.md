# Plan: Rename Medirus → medirus

Quyết định đã chốt:
- Casing map: `Medirus`→`Medirus`, `medirus`→`medirus`, `medirus`→`medirus`, `MEDIRUS`→`MEDIRUS`, `medirus`→`medirus_`, `medirus-`→`medirus-`
- Domain: `medirus.online`→`medirus.online`, `api.medirus.online`→`api.medirus.online`, `medirus.online`→`medirus.online`
- Breaking OK: storage keys, `window.Medirus`, env vars `MEDIRUS_*` đổi hết.
- GIỮ NGUYÊN: author `nichxbt`, `github.com/*/Medirus` URLs (repo chưa rename trên GitHub), `bin/unfollowx`, thư mục `xspace-agents/`.

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
  [/api\.medirus\.app/g,            'api.medirus.online'],
  [/api\.medirus\.io/g,             'api.medirus.online'],
  [/medirus\.app/g,                 'medirus.online'],
  [/medirus\.io/g,                  'medirus.online'],
  [/MEDIRUS(?=[_A-Z0-9]|\b)/g,     'MEDIRUS'],       // env vars
  [/medirus_/g,                     'medirus_'],       // storage keys
  [/medirus-/g,                     'medirus-'],
  [/Medirus(?=[A-Z]|\b)/g,          'Medirus'],        // MedirusClient → MedirusClient
  [/(?<![A-Za-z])medirus/g,         'medirus'],        // (?<!...) bảo vệ maxActions!
  [/(?<![A-Za-z0-9_.\/-])medirus\b/g, 'medirus'],      // standalone; skip github URL path
];
```

Guard riêng cho URL: **không** replace `medirus` khi nằm trong `github.com/<user>/medirus` hoặc `github.com/<user>/Medirus` — dùng negative lookbehind/lookahead hoặc whitelist-skip dòng chứa `github.com/nirholas/` và `github.com/deptrai/`… rồi review tay phần còn lại (docs nói về repo URL có thể muốn đổi text hiển thị nhưng giữ href).

Edge cases đã thống kê:
- `maxActions` / `CONFIG.maxActions` (~80 chỗ) — KHÔNG đụng (lookbehind).
- `medirussettings`, `medirususer` (key nối liền) — rule riêng: `\bxactions(?=settings|user)` → `medirus`.
- `window.Medirus*` — rule `Medirus` cover được (`window.Medirus`, `window.MedirusToolbox`…).
- `org.medirus.scrape.completed` event names → `org.medirus.*` (rule `medirus.` boundary xử lý).
- `medirus` (n8n node name), `MedirusApi` credentials, `MedirusTrigger` → `medirus`, `MedirusApi`, `MedirusTrigger`.
- Lock files: sau replace, `package-lock.json`/`pnpm-lock.yaml` có field `name` cũ — chạy `npm install --package-lock-only` hoặc sed name field.

## Phase 2 — Rename file/dir có `medirus`/`Medirus` trong tên

`git mv` (giữ history), case-sensitive 2 bước trên macOS (filesystem case-insensitive):
`git mv Medirus x_tmp && git mv x_tmp medirus`.

Danh sách chính (~40 mục, generate bằng `find . -iname '*medirus*' -not -path './node_modules/*'`):
- `packages/medirus-mcp` → `packages/medirus-mcp` (+ sửa package.json name, bin, refs)
- `integrations/n8n/nodes/Medirus/` → `Medirus/` (class `Medirus.node.js` → `Medirus.node.js`, `MedirusApi.credentials.js` → `MedirusApi.credentials.js`)
- `skills/medirus-cli`, `skills/medirus-mcp-server`, `skills/medirus-test-engineer`
- `docs/medirus-reference.md`, `dashboard/docs/guides/medirus-reference.html`, `dashboard/docs/skills/medirus-*.html`
- `scripts/twitter/medirus-command-center.js`, `dashboard/scripts/medirus-command-center.html`, `dashboard/medirus-ascii.svg`, `.github/medirus-ascii.svg`
- `medirus-demo-*.png`, `.playwright-mcp/medirus-*.csv`, `_bmad-output/**/medirus-*` (~20 artifact dirs/files)
- File served `medirus.js` (CDN script ref `medirus.online/scripts/medirus.js`) → `medirus.js`

## Phase 3 — Config & package metadata (sửa tay, review kỹ)

- `package.json`: `name: "medirus"`, bins `medirus`, `medirus-mcp`, `medirus-agent`; homepage `medirus.online`; keywords thay `medirus`; giữ `unfollowx` bin.
- `packages/medirus-mcp/package.json` → `medirus-mcp` v3.x (major bump vì breaking).
- `wrangler.toml`: worker `name = "medirus"`.
- `railway.toml`, `fly.toml`, `vercel.json`, `deploy/gcp/cloudbuild-api.yaml`, `docker-compose*.yml`, `Dockerfile` labels, `.github/workflows/*` (image name, deploy target, sitemap URL).
- `public/sitemap.xml`, `dashboard/sitemap.xml`, `dashboard/docs/_sitemap-*.xml` — regenerate hoặc sed domain.
- `.github/repository-metadata.json`, `CODEOWNERS`, `copilot-instructions.md`.
- `bin/unfollowx` giữ nguyên tên file + shebang, chỉ đổi text `Medirus` trong comments/logic.

## Phase 4 — Bề mặt breaking (đã duyệt)

- Env `MEDIRUS_*` → `MEDIRUS_*` (~30 vars: SERVICE_KEYS, MCP_API_KEY, SESSION_COOKIE, API_TOKEN, MODE, BROWSER_POOL_SIZE, BROWSER_BACKEND, SCRAPER_ADAPTER, STOP, NO_TELEMETRY, VIDEO_URLS, VD_CAPTURED, DEFAULT_USERNAME, ARTIFACT_DIR, TEST_FAST_DELAYS…)
- Storage keys `medirus_*` → `medirus_*` (~50 keys)
- `window.Medirus*` → `window.Medirus*`
- Class/function exports: `MedirusClient`, `MedirusUtils`, `MedirusOptions`, `medirusClient`, `stopMedirusMonitor`…
- `.env.example`, docs env tables, CI secrets (`.github/workflows` dùng `secrets.MEDIRUS_*` → cần đổi tên secret trên GitHub UI sau).

## Phase 5 — Verify

```bash
rg -i 'medirus|x.actions' --hidden --glob '!.git' --glob '!node_modules' \
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
6. (Ngoài repo, sau): rename GitHub repo → update `github.com/*/Medirus` URLs; đổi npm package (deprecate `medirus`, publish `medirus`); trỏ domain medirus.online; đổi secrets CI.
