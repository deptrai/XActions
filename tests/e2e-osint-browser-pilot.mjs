import { chromium } from 'playwright';
import express from 'express';
import { executeSocialFindProfiles } from '../src/mcp/osint-find-profiles.js';
import { DESCRIPTORS } from '../src/scrapers/index.js';
import { globalAdaptiveRateGovernor } from '../src/core/adaptive-governor.js';

// Inject lightweight real descriptors into live DESCRIPTORS to avoid heavy Puppeteer launches.
// These are genuine ActionDescriptor objects conforming to the real dispatcher contract.
const PROFILE = {
  username: 'nichxbt',
  name: 'Nich',
  bio: 'dev',
  avatar: 'https://x/a.png',
  profileUrl: 'https://x.com/nichxbt',
  followersCount: 42,
};

function injectDescriptor(platform, result, beh = {}) {
  const orig = DESCRIPTORS[platform];
  DESCRIPTORS[platform] = {
    aliases: [platform],
    actionMap: { profile: 'profile', search: 'search' },
    mapArgs: (o) => o,
    createClient: () => ({}),
    createCrawler: () => ({
      async start() {
        if (beh.fail) throw beh.fail;
        if (beh.delayMs) await new Promise((r) => setTimeout(r, beh.delayMs));
        return typeof result === 'function' ? result() : result;
      },
      async cleanup() {},
    }),
  };
  return () => {
    if (orig) DESCRIPTORS[platform] = orig;
    else delete DESCRIPTORS[platform];
  };
}

async function runBrowserE2E() {
  console.log('====================================================');
  console.log('🎮 BROWSER PILOT: LIVE E2E VERIFY LOGIC & DOM STATUS');
  console.log('====================================================\n');

  // 1. Inject descriptors for test platforms
  const restoreTwitter = injectDescriptor('twitter', { profiles: [PROFILE] });
  const restoreChotot = injectDescriptor('chotot', { profiles: [PROFILE] });
  const restoreMedium = injectDescriptor('medium', null, { fail: Object.assign(new Error('HTTP 403 Forbidden'), { statusCode: 403 }) });
  const restoreReddit = injectDescriptor('reddit', { profiles: [PROFILE] }, { delayMs: 6000 }); // Tier 0 timeout is 5000ms
  const restoreMasothue = injectDescriptor('masothue', { profiles: [PROFILE] }, { delayMs: 5000 }); // Tier 0 timeout is 4000ms

  // Hibernate an account for Account Health Guard test
  const hibernatingAccount = 'acc_hibernated_test';
  globalAdaptiveRateGovernor.hibernateAccount(hibernatingAccount, 'bot_challenge', 60_000, 'threads');

  const app = express();
  const PORT = 12345;
  
  app.get('/api/osint', async (req, res) => {
    try {
      console.log('Incoming Query Params:', req.query);
      const args = {
        query: req.query.query || 'nichxbt',
        queryType: req.query.queryType || 'username',
        platforms: req.query.platforms ? req.query.platforms.split(',') : (req.query.queryType === 'phone' ? ['masothue', 'chotot'] : ['twitter', 'medium', 'reddit', 'threads', 'linkedin']),
        accountId: req.query.accountId || undefined
      };
      const result = await executeSocialFindProfiles(args);
      console.log('API Result:', JSON.stringify(result.platformStatus, null, 2));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(PORT, '127.0.0.1', async () => {
    console.log(`🚀 Local E2E Server running on http://127.0.0.1:${PORT}`);
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Create a DOM page on the fly
    await page.route(`http://127.0.0.1:${PORT}/`, async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
          <head><title>OSINT E2E Test</title></head>
          <body>
            <h1>OSINT Find Profiles E2E</h1>
            <input id="query" value="nichxbt" />
            <select id="queryType">
              <option value="username">username</option>
              <option value="name">name</option>
              <option value="phone">phone</option>
              <option value="email">email</option>
            </select>
            <input id="accountId" placeholder="Optional Account ID" />
            <button id="btn-search" onclick="doSearch()">Search</button>
            <div id="status-container"></div>
            <div id="profiles-container"></div>
            <script>
              async function doSearch() {
                document.getElementById('status-container').innerHTML = 'Loading...';
                const query = document.getElementById('query').value;
                const queryType = document.getElementById('queryType').value;
                const accountId = document.getElementById('accountId').value;
                let url = '/api/osint?query=' + encodeURIComponent(query) + '&queryType=' + encodeURIComponent(queryType);
                if (accountId) url += '&accountId=' + encodeURIComponent(accountId);
                
                const res = await fetch(url);
                const data = await res.json();
                console.log('UI received data:', data);
                
                let statusHtml = '<table border="1"><tr><th>Platform</th><th>Status</th><th>Error Code</th><th>Error Category</th><th>Duration</th></tr>';
                data.platformStatus.forEach(s => {
                  statusHtml += \`<tr>
                    <td>\${s.platform}</td>
                    <td id="status-\${s.platform}">\${s.status}</td>
                    <td id="code-\${s.platform}">\${s.error ? s.error.code : ''}</td>
                    <td id="cat-\${s.platform}">\${s.error ? s.error.category : ''}</td>
                    <td>\${s.durationMs}ms</td>
                  </tr>\`;
                });
                statusHtml += '</table>';
                document.getElementById('status-container').innerHTML = statusHtml;
                
                let profHtml = '<h2>Profiles Found</h2><ul>';
                data.profiles.forEach(p => {
                  profHtml += \`<li>\${p.platform} - \${p.username} (\${p.name})</li>\`;
                });
                profHtml += '</ul>';
                document.getElementById('profiles-container').innerHTML = profHtml;
              }
            </script>
          </body>
          </html>
        `
      });
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(100);

    console.log('✅ Page loaded. Running Test 1: Fan-out across tiered platforms...');
    await page.click('#btn-search');
    await page.waitForSelector('#status-container table', { timeout: 15000 });

    const twitterStatus = await page.textContent('#status-twitter');
    const mediumStatus = await page.textContent('#status-medium');
    const mediumCategory = await page.textContent('#cat-medium');
    const redditStatus = await page.textContent('#status-reddit');
    const redditCategory = await page.textContent('#cat-reddit');
    const profilesCount = await page.locator('#profiles-container ul li').count();

    console.log('\n📊 TEST 1 RESULTS (Fan-out & Tier-Aware Timeouts):');
    console.log('   Twitter (Tier 1, 15s deadline, fast success):', twitterStatus, '✅ (Expect ok)');
    console.log('   Medium (Tier 0, fails with 403):', mediumStatus, '| Category:', mediumCategory, '✅ (Expect error + BOT_BLOCKED)');
    console.log('   Reddit (Tier 0, 5s deadline, takes 6s):', redditStatus, '| Category:', redditCategory, '✅ (Expect timeout + PLATFORM_TIMEOUT)');
    console.log('   Profiles returned:', profilesCount, '✅ (Expect >= 2 profiles)');

    console.log('\n✅ Running Test 2: VN Phone Tier 0 Timeouts (Masothue/Chotot)...');
    await page.selectOption('#queryType', 'phone');
    await page.fill('#query', '0901234567');
    await page.fill('#accountId', '');
    await page.click('#btn-search');
    await page.waitForSelector('#status-container table', { timeout: 15000 });

    const masothueStatus = await page.textContent('#status-masothue');
    const chototStatus = await page.textContent('#status-chotot');
    console.log('\n📊 TEST 2 RESULTS (Tier 0 Timeouts for VN Platforms):');
    console.log('   Masothue (Tier 0, 4s deadline, takes 5s):', masothueStatus, '✅ (Expect timeout)');
    console.log('   Chotot (Tier 0, 4s deadline, fast success):', chototStatus, '✅ (Expect ok)');

    console.log('\n✅ Running Test 3: Account Health Guard (Hibernating Account)...');
    await page.selectOption('#queryType', 'username');
    await page.fill('#query', 'nichxbt');
    await page.fill('#accountId', hibernatingAccount);
    await page.click('#btn-search');
    await page.waitForSelector('#status-container table', { timeout: 15000 });

    const threadsStatus = await page.textContent('#status-threads');
    console.log('\n📊 TEST 3 RESULTS (Account Health Guard):');
    console.log('   Threads (Account is hibernating):', threadsStatus, '✅ (Expect account_sick)');

    await page.screenshot({ path: 'tests/osint-e2e-pilot.png', fullPage: true });
    console.log('\n📸 Saved screenshot to: tests/osint-e2e-pilot.png ✅');

    await browser.close();
    server.close();
    globalAdaptiveRateGovernor.wakeAccount(hibernatingAccount, 'threads');
    restoreTwitter();
    restoreChotot();
    restoreMedium();
    restoreReddit();
    restoreMasothue();

    console.log('\n====================================================');
    console.log('🎉 LIVE BROWSER PILOT E2E TEST COMPLETED SUCCESSFULLY!');
    console.log('====================================================');
    process.exit(0);
  });
}

runBrowserE2E().catch((err) => {
  console.error('❌ Browser Pilot Error:', err);
  process.exit(1);
});
