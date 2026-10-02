// by nichxbt
// Browser Pilot Live E2E: Test Scraper Features from Sidebar Navigation
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('tests/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const BASE_URL = 'http://localhost:3000';

const SCRAPER_ROUTES = [
  {
    name: 'Universal Explorer',
    path: '/explorer',
    group: 'intelligence',
    expectedSelector: 'h1, h2, h3',
    expectedKeywords: ['Universal Explorer', 'Explorer', 'Jobs', 'Real Estate'],
    screenshot: '01-nav-explorer.png',
  },
  {
    name: 'Enterprise VN',
    path: '/enterprise-vn',
    group: 'platform-suites',
    expectedSelector: 'input[placeholder*="MST"], input[placeholder*="thuế"], input[type="text"], input[type="search"]',
    expectedKeywords: ['Enterprise', 'Doanh nghiệp', 'Mã số thuế', 'Tra cứu'],
    screenshot: '02-nav-enterprise-vn.png',
  },
  {
    name: 'Jobs VN',
    path: '/jobs-vn',
    group: 'platform-suites',
    expectedSelector: 'input[placeholder*="việc"], input[placeholder*="job"], input[type="text"], input[type="search"]',
    expectedKeywords: ['Jobs VN', 'TopCV', 'VietnamWorks', 'Tuyển dụng', 'LinkedIn'],
    screenshot: '03-nav-jobs-vn.png',
  },
  {
    name: 'Dexscreener',
    path: '/dexscreener',
    group: 'platform-suites',
    expectedSelector: 'input[placeholder*="token"], input[placeholder*="pair"], input[type="text"], input[type="search"]',
    expectedKeywords: ['Dexscreener', 'Pairs', 'Tokens', 'Solana', 'Liquidity'],
    screenshot: '04-nav-dexscreener.png',
  },
  {
    name: 'Facebook Scraper',
    path: '/facebook',
    group: 'intelligence',
    expectedSelector: 'button:has-text("Scrape Feed"), button, div',
    expectedKeywords: ['Facebook', 'Scrape Feed', 'Auto Like', 'Friend Analysis'],
    screenshot: '05-nav-facebook.png',
  },
  {
    name: 'YouTube Suite',
    path: '/youtube',
    group: 'platform-suites',
    expectedSelector: 'input[type="text"], input[type="search"], button',
    expectedKeywords: ['YouTube', 'Video', 'Channel', 'Trending'],
    screenshot: '06-nav-youtube.png',
  },
  {
    name: 'Fediverse',
    path: '/fediverse',
    group: 'platform-suites',
    expectedSelector: 'button, div, input',
    expectedKeywords: ['Fediverse', 'Bluesky', 'Mastodon', 'Trending'],
    screenshot: '07-nav-fediverse.png',
  },
  {
    name: 'Pump.fun Scraper',
    path: '/pumpfun',
    group: 'intelligence',
    expectedSelector: 'input[type="text"], input[type="search"], button',
    expectedKeywords: ['Pump.fun', 'Solana', 'Meme', 'Livestream'],
    screenshot: '08-nav-pumpfun.png',
  },
];

async function runScraperNavPilot() {
  console.log('========================================================================');
  console.log('🎮 BROWSER PILOT: KIỂM THỬ E2E CÁC TÍNH NĂNG SCRAPER TRÊN NAVIGATION');
  console.log(`🎯 Target: ${BASE_URL}`);
  console.log('========================================================================\n');

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  // Inject session cookie so middleware grants access without redirecting to /login
  await context.addCookies([
    {
      name: 'xa_session',
      value: 'pilot_e2e_authenticated_session_2026',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'xa_bearer',
      value: 'pilot_e2e_dummy_jwt_token',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  const consoleLogs = [];
  const networkErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleLogs.push({ type: 'error', text: msg.text() });
    }
  });

  page.on('pageerror', (err) => {
    consoleLogs.push({ type: 'pageerror', text: err.message });
  });

  page.on('requestfailed', (req) => {
    networkErrors.push({ url: req.url(), error: req.failure()?.errorText });
  });

  const results = [];

  // 1. Initial Load: Check root dashboard and sidebar
  console.log('1. Khởi tạo phiên & Điều hướng vào Trang chủ Dashboard:');
  const initStartTime = Date.now();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);
  const currentUrl = page.url();
  const pageTitle = await page.title();
  const initDuration = Date.now() - initStartTime;

  console.log(`   URL hiện tại: ${currentUrl}`);
  console.log(`   Tiêu đề trang: ${pageTitle}`);
  console.log(`   Thời gian tải: ${initDuration}ms`);

  const redirectedToLogin = currentUrl.includes('/login');
  if (redirectedToLogin) {
    console.error('❌ Bị redirect về /login! Cookie auth chưa hợp lệ.');
    await browser.close();
    process.exit(1);
  } else {
    console.log('   ✅ Xác thực thành công: Đã vào ứng dụng (không bị redirect về /login)');
  }

  // 2. Ensure Sidebar Groups are expanded
  console.log('\n2. Kiểm tra Sidebar và mở rộng các nhóm tính năng:');
  // Check if sidebar nav exists
  const sidebarExists = await page.isVisible('nav, aside, [class*="sidebar"]');
  console.log(`   Sidebar container: ${sidebarExists ? '✅ Hiển thị' : '⚠️ Cần kiểm tra'}`);

  // Expand groups: "Platform Suites", "Intelligence"
  const groupButtons = page.locator('button:has-text("Platform Suites"), button:has-text("Intelligence")');
  const countGroups = await groupButtons.count();
  for (let i = 0; i < countGroups; i++) {
    const btn = groupButtons.nth(i);
    const text = await btn.textContent();
    try {
      await btn.click({ timeout: 2000 });
      console.log(`   Đã click mở rộng nhóm: ${text?.trim()}`);
      await page.waitForTimeout(300);
    } catch {
      // already open or not clickable
    }
  }

  // 3. Test Each Scraper Route via Navigation
  console.log('\n3. Bắt đầu kiểm thử tương tác từng Scraper qua Navigation:');

  for (const item of SCRAPER_ROUTES) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`🛫 Kiểm thử: [${item.name}] (${item.path})`);
    const routeStartTime = Date.now();

    try {
      // Find link in sidebar
      const navLink = page.locator(`a[href="${item.path}"]`).first();
      const isNavVisible = await navLink.isVisible();

      if (isNavVisible) {
        console.log(`   Tìm thấy link trên Navigation: ✅`);
        await navLink.click();
      } else {
        console.log(`   Link sidebar chưa thấy trực tiếp (có thể trong nhóm đóng), điều hướng qua URL.`);
        await page.goto(`${BASE_URL}${item.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }

      await page.waitForURL(`**${item.path}*`, { timeout: 10000 });
      await page.waitForTimeout(1200); // Wait for hydration and data fetching

      const routeDuration = Date.now() - routeStartTime;
      const targetUrl = page.url();
      const bodyText = await page.textContent('body');

      // Check for keywords
      const matchedKeywords = item.expectedKeywords.filter((kw) =>
        bodyText.toLowerCase().includes(kw.toLowerCase())
      );

      // Check interactive elements (e.g. search inputs, buttons)
      const inputOrActionCount = await page.locator(item.expectedSelector).count();

      // Specific tests for key scrapers
      let interactionDetail = '';
      if (item.path === '/explorer') {
        // Test switching tabs (Jobs, Real Estate, Enterprises, Social)
        const tabs = page.locator('button:has-text("Real Estate"), button:has-text("Enterprises"), button:has-text("Jobs")');
        const tabCount = await tabs.count();
        if (tabCount > 0) {
          await tabs.first().click();
          await page.waitForTimeout(500);
          interactionDetail = `Đã test click chuyển Tab danh mục (tìm thấy ${tabCount} tabs).`;
        }
      } else if (item.path === '/enterprise-vn') {
        const searchInput = page.locator('input[type="text"], input[placeholder*="MST"], input[placeholder*="thuế"]').first();
        if (await searchInput.isVisible()) {
          await searchInput.fill('0101248141');
          await page.waitForTimeout(300);
          interactionDetail = 'Đã nhập thử nghiệm MST 0101248141 vào ô tra cứu.';
        }
      } else if (item.path === '/jobs-vn') {
        const searchInput = page.locator('input[type="text"], input[type="search"]').first();
        if (await searchInput.isVisible()) {
          await searchInput.fill('Senior React');
          await page.waitForTimeout(300);
          interactionDetail = 'Đã nhập từ khóa tuyển dụng "Senior React" vào ô tìm kiếm.';
        }
      } else if (item.path === '/facebook') {
        const actionBtn = page.locator('button:has-text("Scrape Feed")').first();
        if (await actionBtn.isVisible()) {
          interactionDetail = 'Nút Scrape Feed sẵn sàng tương tác.';
        }
      }

      // Capture screenshot evidence
      const screenshotPath = path.join(SCREENSHOT_DIR, item.screenshot);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      const passed = matchedKeywords.length > 0 && !targetUrl.includes('/login');

      console.log(`   Trạng thái: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`   Thời gian tải: ${routeDuration}ms`);
      console.log(`   Từ khóa khớp: ${matchedKeywords.join(', ')}`);
      console.log(`   Số phần tử tương tác: ${inputOrActionCount}`);
      if (interactionDetail) {
        console.log(`   Tương tác: ${interactionDetail}`);
      }
      console.log(`   Ảnh chụp bằng chứng: ${screenshotPath}`);

      results.push({
        name: item.name,
        path: item.path,
        passed,
        duration: routeDuration,
        matchedKeywords,
        inputCount: inputOrActionCount,
        interactionDetail,
        screenshot: screenshotPath,
        error: null,
      });
    } catch (err) {
      console.error(`   ❌ Lỗi khi test route ${item.path}:`, err.message);
      results.push({
        name: item.name,
        path: item.path,
        passed: false,
        duration: Date.now() - routeStartTime,
        matchedKeywords: [],
        inputCount: 0,
        interactionDetail: '',
        screenshot: null,
        error: err.message,
      });
    }
  }

  await browser.close();

  // Print Summary
  console.log('\n========================================================================');
  console.log('📊 TỔNG HỢP KẾT QUẢ KIỂM THỬ BROWSER PILOT (SCRAPER ON NAVIGATION)');
  console.log('========================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`Kết quả: ${passedCount}/${totalCount} tính năng Scraper ĐẠT yêu cầu (${Math.round((passedCount / totalCount) * 100)}%)\n`);

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} [${r.name}] (${r.path}) - ${r.duration}ms`);
    if (r.error) {
      console.log(`   Lỗi: ${r.error}`);
    } else {
      console.log(`   Keywords: ${r.matchedKeywords.slice(0, 3).join(', ')} | Tương tác: ${r.interactionDetail || 'OK'}`);
    }
  }

  if (consoleLogs.length > 0) {
    console.log(`\n⚠️ Số lỗi console ghi nhận trong quá trình duyệt: ${consoleLogs.length}`);
    for (const c of consoleLogs.slice(0, 5)) {
      console.log(`   - [${c.type}] ${c.text.slice(0, 150)}`);
    }
  } else {
    console.log('\n✨ Không có lỗi nghiêm trọng nào trong Console.');
  }

  console.log('\n========================================================================');
  console.log('🎉 KIỂM THỬ HOÀN TẤT!');
  console.log('========================================================================');
}

runScraperNavPilot().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
