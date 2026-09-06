---
title: "Backlog — Epic 21 & 22: B2B Procurement / Automotive / F&B / Healthcare / Legal Intelligence"
created: 2026-08-26
status: reactivated
reason: "Vietnam market pivot approved 2026-09-05. PRD FR-94→96 added. Spec retained — moved to epics.md Phase A. Feasibility verified via live probes (research/technical-vietnam-multi-domain-scrapers-2026-08-21.md)."
---

# Backlog — Epic 21 & 22

> **Moved from `epics.md` during Implementation Readiness review 2026-08-26.**
> These epics are kept as validated backlog items for a future phase. They should not be scheduled in the current Phase 4 sprint until a dedicated PRD, UX, and architecture review are completed.

---

## Epic 21: B2B Procurement, Corporate & Automotive Intelligence Engine

### Story 21.1: B2B Tender & Company Registry Crawler (Mạng Đấu thầu, MaSoThue & HoSoCongTy)
As an **Enterprise B2B Sales & Tender Intelligence Analyst**,
I want **cào danh bạ hơn 150.000 doanh nghiệp mới thành lập mỗi năm (MST, tên doanh nghiệp, người đại diện pháp luật, SĐT, ngành nghề, địa chỉ) và dữ liệu mời thầu/trúng thầu từ Hệ thống Mạng Đấu thầu Quốc gia (`muasamcong.mpi.gov.vn`) và các cổng tra cứu (`masothue.com`, `hosocongty.vn`)**,
So that **Nowing AI Lead Hub tự động phát hiện và chấm điểm khách hàng tiềm năng cho các dịch vụ: Chữ ký số, Hóa đơn điện tử, Mở tài khoản ngân hàng, Văn phòng trọn gói, Bảo hiểm doanh nghiệp, và cung cấp tin thầu sớm cho các nhà cung ứng thiết bị/xây dựng**.

**Acceptance Criteria:**
* **Given** `B2BRegistryCrawler` trong `src/scrapers/procurement/b2b-registry/index.js` kế thừa `AbstractCrawler`
* **When** gọi `searchTenders(keyword)` hoặc `searchNewCompanies({ city, industry, establishedWithinDays })`
* **Then** scraper gọi API / HTML gateway công khai (`No-Auth`) qua `ProxyIpPool` với throughput > 200 req/s
* **And** trích xuất đầy đủ: `metadata: { taxCode, companyName, representativeName, phone, businessLines, charterCapital, establishedDate, tenderValue, tendererName, bidderList }`
* **And** chuẩn hóa theo schema `PostItem` (`platform: 'masothue' | 'muasamcong' | 'hosocongty'`, `category: 'b2b_lead'`)
* **And** lưu vào PostgreSQL qua `PrismaStore` và phát Thin Event vào Redis Stream `stream:social:raw_posts`.

### Story 21.3: HoSoCongTy & MuaSamCong Crawler (Cloudflare/SPA fallback)
As a **B2B Procurement Analyst**,  
I want **to scrape `hosocongty.vn` and `muasamcong.mpi.gov.vn` once Cloudflare/SPA blockers are resolved**,  
So that **Nowing has richer company director/phone data and tender details beyond the MaSoThue baseline**.

**Acceptance Criteria:**
* **Given** `B2BRegistryExtendedCrawler` in `src/scrapers/procurement/b2b-registry-extended/index.js` extends `AbstractCrawler`
* **When** calling `scrape('hosocongty','company',{ taxCode })` or `scrape('muasamcong','search_tenders',{ keyword })`
* **Then** scraper uses a documented Cloudflare bypass (Epic 27 TLS/JA4 or StealthBrowser cookie warmup) for HoSoCongTy and HTML/authenticated API fallback for MuaSamCong
* **And** extracts full fields: `taxCode`, `companyName`, `representativeName`, `phone`, `businessLines`, `charterCapital`, `establishedDate`, `tenderValue`, `tendererName`, `bidderList`
* **And** normalizes to `PostItem` (`platform: 'hosocongty' | 'muasamcong'`, `category: 'b2b_lead'`)
* **And** persists via `PrismaStore` and publishes `ThinEvent` to `stream:social:raw_posts`
* **Note:** This story is **blocked** until `technical-cloudflare-vn-b2b-endpoints-2026-09-06` unblocking conditions are met.

### Story 21.2: Automotive & Vehicles Market Crawler (Oto.com.vn, Bonbanh & Chợ Tốt Xe)
As an **Automotive Trader & Auto Finance Lead Broker**,
I want **cào danh mục tin rao bán ô tô, xe máy, xe điện từ các chuyên trang `Oto.com.vn`, `Bonbanh.com` và `Chợ Tốt Xe`**,
So that **Nowing AI Lead Hub phát hiện các tin rao xe chính chủ/salon cần bán gấp, khách hàng cần vay trả góp, và thu thập dữ liệu định giá xe ô tô thị trường**.

**Acceptance Criteria:**
* **Given** `AutomotiveCrawler` trong `src/scrapers/vehicles/automotive/index.js` kế thừa `AbstractCrawler`
* **When** gọi `searchVehicles({ brand, model, yearRange, priceRange, city })`
* **Then** scraper cào dữ liệu qua HTTP Client kết hợp Proxy Pool
* **And** bóc tách đầy đủ: hãng xe, dòng xe (model), năm sản xuất (Model Year), số km đã đi (Mileage), hộp số, nhiên liệu, giá bán, salon/chính chủ, và số điện thoại liên hệ
* **And** tự động phát hiện và xử lý số điện thoại chính chủ (lọc bỏ mask `***`)
* **And** chuẩn hóa theo schema `PostItem` (`platform: 'oto_vn' | 'bonbanh' | 'chotot_xe'`, `category: 'automotive'`)
* **And** lưu vào PostgreSQL qua `PrismaStore` và phát Thin Event vào Redis Stream `stream:social:raw_posts`.

---

## Epic 22: Local F&B Merchant, Healthcare & Legal Intelligence Engine

### Story 22.1: F&B Merchant & Restaurant Directory Crawler (PasGo, Foody & Riviu)
As a **F&B SaaS Sales Director & Food Supply Chain Manager**,
I want **cào danh bạ hơn 330.000 nhà hàng, quán ăn, quán cafe từ PasGo, Foody và Riviu**,
So that **Nowing AI Lead Hub tự động phát hiện các quán mới mở, địa điểm kinh doanh sầm uất để bán phần mềm quản lý POS (POS365, iPOS, CukCuk, KiotViet) và phân phối nguyên liệu thực phẩm B2B**.

**Acceptance Criteria:**
* **Given** `FnbMerchantCrawler` trong `src/scrapers/fnb/merchant/index.js` kế thừa `AbstractCrawler`
* **When** gọi `searchRestaurants({ category, district, city })` hoặc `getNewlyOpened()`
* **Then** scraper gọi REST API mobile app của nền tảng kết hợp TLS Spoofing
* **And** bóc tách tên quán, chủ quán/quản lý, số hotline đặt bàn, địa chỉ chi tiết, tọa độ GPS, menu giá và review rating
* **And** chuẩn hóa theo schema `PostItem` (`platform: 'pasgo' | 'foody' | 'riviu'`, `category: 'fnb_merchant'`)
* **And** lưu vào PostgreSQL qua `PrismaStore` và phát Thin Event vào Redis Stream `stream:social:raw_posts`.

### Story 22.2: Healthcare, Clinics & Pharmacy Network Crawler (Medpro, YouMed & Thuocsi)
As a **Healthcare Tech & Pharma B2B Sales Lead**,
I want **cào danh bạ bác sĩ chuyên khoa, phòng khám đa khoa, nhà thuốc bán lẻ và giá sỉ dược phẩm từ Medpro, YouMed, Thuocsi.vn**,
So that **Nowing AI cung cấp danh bạ khách hàng tiềm năng cho các công ty Dược phẩm, đơn vị cung cấp thiết bị phòng khám (máy siêu âm, xét nghiệm) và vật tư y tế**.

**Acceptance Criteria:**
* **Given** `HealthcareCrawler` trong `src/scrapers/healthcare/index.js` kế thừa `AbstractCrawler`
* **When** gọi `searchClinics({ specialty, city })` hoặc `getWholesalePharmaCatalog()`
* **Then** scraper cào dữ liệu qua REST Gateway
* **And** bóc tách tên phòng khám/nhà thuốc, bác sĩ phụ trách, chuyên khoa, hotline liên hệ, địa chỉ, lịch khám, và bảng giá dược phẩm
* **And** chuẩn hóa theo schema `PostItem` (`platform: 'medpro' | 'youmed' | 'thuocsi'`, `category: 'healthcare'`)
* **And** lưu vào PostgreSQL qua `PrismaStore` và phát Thin Event vào Redis Stream `stream:social:raw_posts`.

### Story 22.3: Legal & Trademark Intellectual Property Crawler (Cục Sở hữu Trí tuệ)
As an **IP Lawyer & Brand Agency Marketing Lead**,
I want **cào dữ liệu công báo đơn đăng ký nhãn hiệu, sáng chế và sở hữu công nghiệp mới nộp từ Cục Sở hữu Trí tuệ (`wipo.ipvietnam.gov.vn`)**,
So that **Nowing AI phát hiện các doanh nghiệp chuẩn bị ra mắt sản phẩm/thương hiệu mới để tiếp cận sớm cung cấp dịch vụ Marketing, Thiết kế bao bì, Công bố chất lượng sản phẩm và Luật thương hiệu**.

**Acceptance Criteria:**
* **Given** `IpLegalCrawler` trong `src/scrapers/legal/ip-trademark/index.js` kế thừa `AbstractCrawler`
* **When** gọi `scrapeGazette({ issueMonth, classList })`
* **Then** scraper cào dữ liệu công báo điện tử từ cổng tra cứu WIPO IP Vietnam
* **And** bóc tách số đơn, ngày nộp đơn, tên nhãn hiệu, mẫu nhãn hiệu/logo, tên người nộp đơn (chủ doanh nghiệp), địa chỉ người nộp đơn, nhóm ngành hàng (Nice Classification)
* **And** chuẩn hóa theo schema `PostItem` (`platform: 'ipvietnam'`, `category: 'intellectual_property'`)
* **And** lưu vào PostgreSQL qua `PrismaStore` và phát Thin Event vào Redis Stream `stream:social:raw_posts`.

---

## Conditions to Reactivate

1. Product Council approves a new PRD covering B2B / Local verticals (FR-89+, NFR-18+).
2. UX personas, flows, and mockups are created for the new domains.
3. Architecture review confirms `AbstractCrawler`, `ProxyIpPool`, and `PrismaStore` can support the new platform adapters without core changes.
4. Legal/compliance review for government data (tenders, IP gazette, company registries, healthcare).
