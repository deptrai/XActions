---
title: "Product Brief Addendum: Deep Technical & Architectural Specifications (25 Modules)"
subtitle: "The Manus-Killer Unified Ecosystem (Chainlens + Nowing)"
status: approved
created: "2026-08-20"
updated: "2026-08-20"
---

# 📚 Addendum: Deep Technical Architecture for All 25 Modules

## 1. Chi tiết Kiến trúc 25 Phân hệ Kỹ thuật (Technical Specs)

### 🖥️ Workstation & UX Plane (Nowing Frontend - Next.js 16 + React 19)
1. **Glass Box Split Canvas:** Layout Resizable Panel (340px Chat / 800px+ Canvas). Canvas hỗ trợ 5 tab tương tác: `Live Browser`, `Terminal`, `File Explorer`, `Web Preview`, `Artifact Diff`.
2. **Thought & Action Tree:** Nhận SSE events (`event: thought`, `event: action`, `event: observation`) từ FastAPI backend, render cây suy luận phân cấp với trạng thái collapse/expand và syntax highlighting.
3. **Time-Travel Checkpoints:** Mỗi bước thực thi lưu snapshot trạng thái vào PostgreSQL (`task_checkpoints`). Người dùng bấm "Rollback to here" sẽ tạo branch session mới từ checkpoint ID đó.
4. **Human Live Takeover:** WebSocket stream hình ảnh CDP/VNC từ container browser về frontend (< 50ms). Khi người dùng bấm "Take over", backend pause agent loop và cho phép chuột/phím từ frontend tương tác trực tiếp với container.
5. **Projects Knowledge Base:** Lưu trữ Master Instructions và tài liệu mẫu (PDF, DOCX). Khi tạo task trong Project, backend tự động inject prompt prefix và RAG context từ knowledge base.
6. **Multi-User Collab:** Tích hợp Zero-Cache CDC (< 10ms) và Yjs WebSocket để đồng bộ con trỏ chuột, selections và inline comments trên từng artifact.
7. **Desktop Native App:** Bọc Next.js frontend bằng Tauri (Rust) để cung cấp global hotkey `Cmd+K`, local file drop, và tray notification.

### ⚡ Virtual Execution Plane (Nowing Python Worker + Chainlens DSH Engine)
8. **Cloud Browser Sandbox (Nowing):** Docker container chạy headless Chromium qua Playwright, có xvfb và virtual display để chụp screenshot realtime.
9. **Browser Operator Chrome Extension (Nowing):** Chrome Extension (Manifest V3) kết nối qua WebSocket tới Nowing local agent bridge, sử dụng `chrome.debugger` API (CDP) để click, type, navigate trên các tab đã đăng nhập sẵn cookies.
10. **Linux Shell Sandbox (Nowing):** Container Docker chạy non-root user, filesystem cô lập tại `/workspace`, giới hạn 512MB RAM, 1 CPU Core, PID 1 `tini`, và timeout 60s.
11. **In-Sandbox Python Data Studio (Nowing):** Môi trường Python tích hợp sẵn Pandas, NumPy, SciPy, Matplotlib, Seaborn, Altair để thực thi data science scripts.
12. **Wide Research Swarm Engine (Chainlens):** Nhúng `@deepseek-ai/dsh` / Cordis plugin vào NestJS. Controller phân rã đề tài thành danh sách thực thể $\rightarrow$ Điều phối 50 subagents cào song song qua SearXNG Pool $\rightarrow$ Trích xuất facts $\rightarrow$ Gom thành bảng JSON Ma trận so sánh.
13. **Fact-Checking & Citation Guard (Chainlens):** Pipeline kiểm chứng atomic claim bằng Cosine Similarity trên pgvector embedding (ngưỡng 0.82) và đối chiếu với URL gốc.
14. **Workspace File Manager (Nowing):** REST API `/api/v1/workspaces/:id/files` hỗ trợ upload, download, browse tree, và package thành file `.zip`.

### 🎨 Deliverables Studio Plane (Nowing Creative Engines)
15. **Full-Stack Web Builder (Nowing):** LLM sinh project React / Next.js (App Router, Tailwind CSS, Lucide icons, mock data). Lưu mã nguồn vào `/workspace/web-app`.
16. **1-Click Hosting `*.nowing.space` (Nowing):** Build static export (hoặc Node runtime container), tự động sinh Traefik Dynamic Configuration file với rule `Host(`${project}.nowing.space`)` và LetsEncrypt HTTPS.
17. **Design View & Mark Tool (Nowing):** Iframe Preview bọc một Bounding Box Selector. Khi user khoanh vùng phần tử DOM: Frontend bóc XPath / CSS Selector $\rightarrow$ Gửi về LLM kèm prompt yêu cầu chỉnh sửa $\rightarrow$ LLM AST-mutate code JSX chính xác.
18. **Manus Slides Studio (Nowing):** Sử dụng Python `python-pptx` và template Marp Markdown để xuất slide 16:9 với theme doanh nghiệp, sơ đồ và speaker notes.
19. **Professional Excel Formatter (Nowing):** Sử dụng `openpyxl` để format bảng dữ liệu: header màu navy/chữ trắng, zebra striping, border mỏng, công thức Excel native, và auto-width columns.
20. **Multimedia & Video Gen (Chainlens/Nowing):** Gọi API Flux/Midjourney để sinh ảnh; tích hợp ElevenLabs API để lồng tiếng kịch bản slide/video.
21. **Deep PDF Table OCR (Nowing):** Sử dụng `Camelot` / `PyMuPDF` / `Marker` để bóc tách bảng đa tầng (nested tables) trong PDF thành cấu trúc bảng chuẩn.

### 📨 Channels & Ecosystem Plane (Nowing Inbound + Chainlens B2B MCP)
22. **Mail Inbound Gateway (Nowing):** Cấu hình SendGrid / Postmark Inbound Webhook trỏ về `POST /api/v1/webhooks/inbound-mail`. Tự động bóc email sender, subject, body, attachments $\rightarrow$ Khởi tạo Mission Task $\rightarrow$ Khi xong gửi email SMTP trả lời kèm deliverables.
23. **Meeting Minutes STT (Nowing):** Pipeline `faster-whisper` (STT tiếng Việt/Anh) + `pyannote.audio` (Speaker Diarization) $\rightarrow$ LLM trích xuất Executive Summary, Key Decisions, và Action Items.
24. **Stateful Scheduled Tasks 2.0 (Nowing):** Celery Beat định kỳ trigger task. Agent tải kết quả của `run_id` trước đó từ DB, chạy cào dữ liệu mới, tính toán Delta diff, và gửi thông báo tổng hợp qua Telegram Bot / Slack Webhook.
25. **B2B API & MCP Suite (Chainlens & Nowing):**
    * `chainlens-research`: Cung cấp MCP tools: `chainlens_wide_research`, `chainlens_search`, `chainlens_ask`, `chainlens_reason`.
    * `nowing`: Cung cấp MCP tools quản lý leads, trigger browser actions, và xuất file.
