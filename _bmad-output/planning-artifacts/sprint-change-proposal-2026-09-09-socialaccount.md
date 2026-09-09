---
type: sprint-change-proposal
issue: 'SocialAccount data model chưa được định nghĩa trong tài liệu canonical'
trigger: 'Story 35.3/35.4 — Instagram session/proxy storage cần `SocialAccount` table'
created: '2026-09-09'
status: approved
---

# Sprint Change Proposal — SocialAccount Schema & Canonical Docs Update

## Section 1: Issue Summary

**Vấn đề:** `SocialAccount` — model lưu trữ session/cookie/proxy dùng chung cho Reddit, Medium, Instagram — chỉ xuất hiện trong story OQ resolutions và review file, nhưng **không có trong** `prd.md`, `epics.md`, và `ARCHITECTURE-SPINE.md` của Epic 35.

**Bối cảnh phát hiện:** Trong quá trình chuẩn bị implement Story 35.3 (Instagram Scraper), câu hỏi "vấn đề này đã được define trong tài liệu đầy đủ chưa?" cho thấy:
- Stories 35.3 và 35.4 đã resolve OQ-2 = "tạo `SocialAccount` table mới"
- Nhưng quyết định này chưa leo lên canonical docs → nguy cơ implement thiếu spec, không nhất quán encryption, thiếu migration path

**Evidence:**
- `SocialAccount` chỉ match trong: `review-epic35-final.md`, `stories/35-3-instagram-scraper.md`, `stories/35-4-unified-proxy-docs.md`
- Không match trong: `prd.md`, `epics.md`, `ARCHITECTURE-SPINE.md`
- `prisma/schema.prisma` chỉ có `FacebookAccount`/`FacebookAccountHealth`, chưa có `SocialAccount`

## Section 2: Impact Analysis

### Epic Impact
- **Epic 35:** Scope vẫn giữ nguyên 4 stories, nhưng **Story 35.4 cần thêm task**: "Define `SocialAccount`/`SocialAccountHealth` schema + migration" — hoặc tạo story mới 35.5.
- **Epic khác:** Không bị ảnh hưởng trực tiếp, nhưng nếu `SocialAccount` trở thành chuẩn, `FacebookAccount` có thể deprecated sau.

### Story Impact
- **Story 35.3 (Instagram):** Phụ thuộc `SocialAccount` cho session persistence. Nếu schema chưa chuẩn, implement sẽ phải guess.
- **Story 35.4 (Proxy + Docs):** Phải thêm `SocialAccount` schema + migration + docs.

### Artifact Conflicts
| Artifact | Vấn đề | Mức độ |
|----------|--------|--------|
| `prd.md` | Thiếu FR cho unified social account storage | High |
| `epics.md` | Epic 35 thiếu scope/AC về data model | Medium |
| `ARCHITECTURE-SPINE.md` | Thiếu IN-6/AD-35-6 về `SocialAccount` storage | High |
| `prisma/schema.prisma` | Thiếu `SocialAccount`/`SocialAccountHealth` model | High |
| Stories 35.3/35.4 | Đã resolve OQ nhưng chưa có canonical backing | Medium |

### Technical Impact
- **Encryption:** Phải dùng AES-256-GCM pattern từ `api/routes/facebookAccounts.js` (salt:iv:authTag:encrypted, scrypt key derivation)
- **Migration:** Cần `npx prisma migrate dev` để tạo `SocialAccount`/`SocialAccountHealth`
- **Code:** `AbstractApiClient`, `AccountPool`, `SessionManager` cần hỗ trợ `SocialAccount` type
- **Tests:** Thêm tests cho encryption/decryption, migration

## Section 3: Recommended Approach

**Selected:** **Option 1 — Direct Adjustment** (hybrid với deferred FacebookAccount migration)

**Rationale:**
- Không cần rollback (Epic 35 chưa implement)
- Không cần giảm scope (vấn đề là thiếu definition, không phải scope quá lớn)
- Effort: Medium (update 4 canonical docs + schema + migration)
- Risk: Low (không phá vỡ existing code)

**Đề xuất cụ thể:**

### 3.1. Cập nhật `prd.md` — Thêm FR-101

**OLD:**
```markdown
* **FR-97 (Zalo OA & YouTube VN Crawler):** ...
```

**NEW:**
```markdown
* **FR-97 (Zalo OA & YouTube VN Crawler):** ...

* **FR-101 (Unified Social Account Storage):** Cung cấp `SocialAccount` và `SocialAccountHealth` Prisma models để lưu trữ session/cookie/proxy dùng chung cho mọi social platform (Reddit, Medium, Instagram, và các platform tương lai). Hỗ trợ `encryptedCookie`, `encryptedProxy`, `metadata Json?`, và quan hệ `User → SocialAccount[]`. Encryption dùng AES-256-GCM với key derivation từ `SESSION_SECRET`/`JWT_SECRET`. (Epic 35.4)
```

**Traceability table update:**
```markdown
| Epic 35 | FR-98, FR-99, FR-100, FR-101 |
| SocialAccount Storage | FR-101 → Epic 35.4 |
```

### 3.2. Cập nhật `epics.md` — Epic 35

**OLD:**
```markdown
## Architecture Decisions

- **AD-35**: Reddit và Medium dùng HTTP-only adapter (không cần browser).
- **AD-36**: Instagram dùng hybrid — `instagrapi` Python bridge hoặc Puppeteer public scraping.
- **AD-37**: Tất cả platform mới phải inject `ProxyProvider` từ `src/proxy/`; default fallback là `PROXY_URL` env.
- **AD-38**: Proxy cho US-resident platforms (Reddit/Medium/Instagram) nên dùng `country-us` hoặc residential proxy, không dùng `country-vn` default.
```

**NEW:**
```markdown
## Architecture Decisions

- **AD-35**: Reddit và Medium dùng HTTP-only adapter (không cần browser).
- **AD-36**: Instagram dùng hybrid — `instagrapi` Python bridge hoặc Puppeteer public scraping.
- **AD-37**: Tất cả platform mới phải inject `ProxyProvider` từ `src/proxy/`; default fallback là `PROXY_URL` env.
- **AD-38**: Proxy cho US-resident platforms (Reddit/Medium/Instagram) nên dùng `country-us` hoặc residential proxy, không dùng `country-vn` default.
- **AD-39**: `SocialAccount`/`SocialAccountHealth` là canonical storage cho session/cookie/proxy của mọi social platform; `FacebookAccount` sẽ được migrate trong epic kế tiếp.
```

**Story 35.4 title update:**
```markdown
| 35.4 | Unified ProxyProvider Injection + SocialAccount Schema + Docs | Hardening | 0.5 sprint |
```

**Scope addition:**
```markdown
**Trong scope:**
- ...
- `SocialAccount`/`SocialAccountHealth` Prisma schema + migration.
```

### 3.3. Cập nhật `ARCHITECTURE-SPINE.md` — Thêm IN-6 + Section Data Storage

**OLD:**
```markdown
- **IN-5**: Session/cookie không hard-code; lấy từ env, CLI args, hoặc `PrismaStore`.
```

**NEW:**
```markdown
- **IN-5**: Session/cookie không hard-code; lấy từ env, CLI args, hoặc `PrismaStore`.
- **IN-6**: Mọi social platform session/cookie/proxy phải lưu trong `SocialAccount` model với `encryptedCookie`/`encryptedProxy` (AES-256-GCM). `FacebookAccount` là legacy — sẽ migrate sau.
```

**Thêm section 5.5 (sau ProxyProvider Integration):**
```markdown
## 5.5. Data Storage — SocialAccount

```javascript
// Prisma schema addition
model SocialAccount {
  id              String   @id @default(cuid())
  userId          String
  platform        String   // 'reddit' | 'medium' | 'instagram' | 'facebook' | ...
  label           String
  encryptedCookie String?
  encryptedProxy  String?
  metadata        Json?    // { sessionId, username, deviceId, etc. }
  createdAt       DateTime @default(now())
  updatedAt       DateTime @default(now()) @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  health          SocialAccountHealth?

  @@unique([userId, platform, label])
  @@index([userId])
  @@index([platform])
}

enum SocialAccountHealthStatus {
  active
  checkpoint
  dead
  banned
}

model SocialAccountHealth {
  id          String   @id @default(cuid())
  accountId   String   @unique
  status      SocialAccountHealthStatus
  reason      String?
  lastCheckAt DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  account     SocialAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

- Encryption: AES-256-GCM, format `salt:iv:authTag:encrypted`, key = `scryptSync(SESSION_SECRET || JWT_SECRET || 'dev-only-key', salt, 32)`
- `metadata` lưu platform-specific fields: Instagram `sessionId`/`username`/`deviceId`, Reddit `refreshToken`, Medium `uid`
- `SocialAccount` thay thế `FacebookAccount` cho mọi platform mới; `FacebookAccount` migration deferred
```

### 3.4. Cập nhật `prisma/schema.prisma` — Thêm SocialAccount models

**Insert sau `FacebookAccountHealth`:**
```prisma
model SocialAccount {
  id              String   @id @default(cuid())
  userId          String
  platform        String
  label           String
  encryptedCookie String?
  encryptedProxy  String?
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @default(now()) @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  health          SocialAccountHealth?

  @@unique([userId, platform, label])
  @@index([userId])
  @@index([platform])
}

enum SocialAccountHealthStatus {
  active
  checkpoint
  dead
  banned
}

model SocialAccountHealth {
  id          String   @id @default(cuid())
  accountId   String   @unique
  status      SocialAccountHealthStatus
  reason      String?
  lastCheckAt DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  account     SocialAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

### 3.5. Cập nhật `User` model — Thêm relation

```prisma
model User {
  // ... existing fields ...
  socialAccounts   SocialAccount[]
}
```

### 3.6. Update Stories

**Story 35.4 — Thêm AC-8:**
```markdown
### AC-8: SocialAccount schema and migration
**Given** `prisma/schema.prisma` is updated with `SocialAccount`/`SocialAccountHealth`  
**When** `npx prisma migrate dev --name add_social_account` is run  
**Then** migration creates tables without errors  
**And** `SocialAccount` can store encrypted session data for Reddit, Medium, Instagram
```

## Section 4: Implementation Handoff

**Scope:** **Minor** — Direct implementation by Developer agent.

**Deliverables:**
1. Update `prd.md` (FR-101 + traceability)
2. Update `epics.md` (Epic 35 scope + AD-39 + Story 35.4 title)
3. Update `ARCHITECTURE-SPINE.md` (IN-6 + Section 5.5 + AD-35-6)
4. Update `prisma/schema.prisma` (SocialAccount + SocialAccountHealth + User relation)
5. Update `stories/35-4-unified-proxy-docs.md` (AC-8)
6. Run `npx prisma migrate dev --name add_social_account`

**Success Criteria:**
- `SocialAccount` defined in all canonical docs
- Prisma migration runs successfully
- Stories 35.3/35.4 reference `SocialAccount` correctly
- No breaking changes to existing `FacebookAccount`

## Section 5: Next Steps

1. **Approve this proposal** → tôi sẽ thực hiện tất cả updates
2. **Chạy migration** → `npx prisma migrate dev`
3. **Bắt đầu Story 35.1** → Reddit scraper với `SocialAccount` support
