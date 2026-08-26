# Blind Hunter Review — 13.8 Facebook Hybrid Marketplace Diff

> Các line được ghi là số dòng trong file diff `13-8-facebook-hybrid-marketplace.diff`.

## Findings

### 1. `category` / `location` bị bỏ qua trong request GraphQL chính
- **Location:** `src/scrapers/social/facebook/crawler.js:393-398` (dryRun/fallback URL) và `410-430` (GraphQL variables)
- **Severity:** `critical`
- **Explanation:** Code validate `category` (slug) và `location` (tên thành phố / URL) nhưng chỉ đưa chúng vào `buildMarketplaceSearchUrl` cho dryRun & browser fallback. Trong `variables` gửi GraphQL, chỉ có `categoryId`, `latitude`, `longitude`, `radiusKm` được dùng. Khi người dùng chỉ truyền `category` hoặc `location` mà không có `categoryId` / tọa độ, tìm kiếm GraphQL sẽ không lọc theo danh mục và vị trí, trả về kết quả không đúng với yêu cầu.

### 2. `after` là alias của `cursor` nhưng không khai báo trong `optionalArgs`
- **Location:** `src/scrapers/social/facebook/crawler.js:205-213` (đăng ký action) và `388-389` (xử lý `args.after`)
- **Severity:** `warning`
- **Explanation:** Hàm `marketplace` hỗ trợ `args.after` như một alias của `cursor`, và API route cũng forward `after`. Tuy nhiên, `registerAction` chỉ liệt kê `cursor` trong `optionalArgs`. Nếu action registry kiểm tra danh sách tham số hợp lệ, request dùng `after` sẽ bị từ chối dù code bên trong có xử lý.

### 3. `resolveMarketplaceLocation` được import nhưng không xuất hiện trong diff
- **Location:** `src/scrapers/social/facebook/crawler.js:185-188` (import) và `386` (gọi hàm)
- **Severity:** `warning`
- **Explanation:** Diff thêm `resolveMarketplaceLocation` vào import từ `../../facebook/normalize.js` và gọi nó trong `marketplace()`, nhưng không có file `src/scrapers/facebook/normalize.js` nào được sửa trong diff để định nghĩa hàm này. Nếu hàm chưa tồn tại ở base, runtime sẽ báo lỗi `ReferenceError` / `SyntaxError` import, làm hỏng toàn bộ module.

### 4. `DEFAULT_FB_DOC_IDS.MARKETPLACE_SEARCH` là placeholder thay vì doc ID thật
- **Location:** `src/scrapers/social/facebook/crawler.js:192-196`
- **Severity:** `warning`
- **Explanation:** Các giá trị `DEFAULT_FB_DOC_IDS` khác đều là chuỗi số GraphQL doc ID thực tế, còn `MARKETPLACE_SEARCH` được để là `'fb_marketplace_search_doc'`. Khi không được override qua `docIds`, `requestGraphQl` sẽ gửi doc_id này và gần như chắc chắn bị lỗi, buộc phải rơi về browser fallback hoặc trả về rỗng.

### 5. API route dễ throw `TypeError` khi `query` không phải string
- **Location:** `api/routes/facebook.js:52`
- **Severity:** `warning`
- **Explanation:** Marketplace branch dùng `(query || '').trim()`. `query` chỉ được ép kiểu JSDoc, không kiểm tra runtime. Nếu client gửi `query: 123`, `query || ''` trả về `123`, gọi `.trim()` trên number sẽ throw `TypeError`. Lỗi này vượt qua validation `PlatformError` của crawler và có thể trả về 500 thay vì 400.

### 6. Chuỗi giá trống được chuyển thành `0`, tạo filter giá không mong muốn
- **Location:** `api/routes/facebook.js:56-59` (và `58-59` cho `priceMin/priceMax`)
- **Severity:** `warning`
- **Explanation:** Route kiểm tra `minPrice !== undefined && minPrice !== null`, nên chuỗi rỗng `""` vẫn đi qua. `Number("") === 0`, sau đó `0` được forward như một bound giá hợp lệ. Ví dụ `maxPrice: ""` sẽ trở thành `maxPrice: 0`, khiến crawler chỉ trả về listing miễn phí thay vì không giới hạn trên.

### 7. Regex kiểm tra `location` URL không neo cuối, chấp nhận mọi path `facebook.com`
- **Location:** `src/scrapers/social/facebook/crawler.js:373-374`
- **Severity:** `warning`
- **Explanation:** Regex `^https?:\/\/(?:www\.)?facebook\.com\/(?:marketplace\/)?` thiếu `$` và chỉ yêu cầu một dấu `/` sau `facebook.com`. Nó sẽ chấp nhận `https://facebook.com/groups/xyz` hoặc `https://facebook.com/settings/...`. Sau đó `resolveMarketplaceLocation` / browser fallback có thể navigate đến trang không phải Marketplace, gây hành vi không mong đợi hoặc rủi ro SSRF nội bộ.

### 8. Kiểm tra `category` chống path traversal dùng blacklist yếu
- **Location:** `src/scrapers/social/facebook/crawler.js:305-312`
- **Severity:** `warning`
- **Explanation:** Chỉ từ chối `..`, `//`, `\` và leading `/`. Dễ bypass bằng URL-encoded traversal (`%2e%2e`), dấu `.` đơn lẻ, separator Unicode, v.v. Vì `category` có thể đưa vào URL path, nên dùng whitelist slug chặt chẽ (ví dụ `^[a-z0-9_-]+$`) thay vì blacklist cấm ký tự.

### 9. Browser fallback không tôn trọng tham số `limit`
- **Location:** `src/scrapers/social/facebook/crawler.js:470-508`
- **Severity:** `warning`
- **Explanation:** Khi GraphQL thất bại, fallback duyệt toàn bộ `a[href*="/marketplace/item/"]` trên trang và push hết vào `postItems` mà không slice theo `limit`. Kết quả trả về có thể nhiều hơn số lượng người dùng yêu cầu, và phân trang cũng không được thực thi trong fallback.

### 10. `note` có thể lộ lỗi nội bộ và gây hiểu nhầm khi fallback rỗng
- **Location:** `src/scrapers/social/facebook/crawler.js:465-466` (lỗi GraphQL) và `509` (ghi đè note fallback)
- **Severity:** `info`
- **Explanation:** `note` được gán từ `err.message` và trả về cho caller, có thể tiết lộ chi tiết lỗi nội bộ hoặc URL tìm kiếm. Ngoài ra, dù `bridge.evaluate` trả về mảng rỗng, `note` vẫn bị ghi đè thành "Used browser fallback", khiến caller nghĩ fallback thành công dù `posts` rỗng.

### 11. URL `dryRun` / fallback bỏ sót nhiều tham số tìm kiếm
- **Location:** `src/scrapers/social/facebook/crawler.js:393-398` (dryRun) và `470-475` (fallback)
- **Severity:** `info`
- **Explanation:** `buildMarketplaceSearchUrl` chỉ nhận `location`, `category`, `minPrice`, `maxPrice`. Nó không được truyền `categoryId`, `radiusKm`, `latitude`, `longitude`, `cursor`. Vì vậy URL xem trước dryRun và URL fallback không phản ánh đầy đủ các filter thực sự được gửi trong GraphQL, gây khó kiểm tra và gỡ lỗi.

### 12. Fallback nuốt lỗi validation item mà không log
- **Location:** `src/scrapers/social/facebook/crawler.js:502-506`
- **Severity:** `info`
- **Explanation:** Trong vòng lặp fallback, `this.validateItem(postItem)` được bọc bởi `catch {}` rỗng, bỏ qua item lỗi mà không cảnh báo. Khác với nhánh GraphQL có `console.warn`, fallback thầm lặng mất dữ liệu, khiến khó phát hiện DOM thay đổi hoặc lỗi normalization.
