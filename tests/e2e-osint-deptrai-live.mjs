import { chromium } from 'playwright';
import express from 'express';
import { executeSocialFindProfiles } from '../src/mcp/osint-find-profiles.js';

const app = express();
app.use(express.json());

// Mount the REAL osint route logic (no auth for local test)
app.post('/api/osint/find-profiles', async (req, res) => {
  try {
    const result = await executeSocialFindProfiles(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(12349, '127.0.0.1', async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();

  await page.route('http://127.0.0.1:12349/', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `
        <!DOCTYPE html><html><head><title>OSINT Live Test</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 24px; }
          h1 { color: #38bdf8; }
          input, select { padding: 10px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #f8fafc; margin-right: 8px; }
          button { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; }
          .status { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; margin: 4px; }
          .ok { background: #065f46; color: #10b981; }
          .error, .timeout { background: #7f1d1d; color: #f87171; }
          .skipped, .account_sick { background: #78350f; color: #fbbf24; }
          .profile { background: #1e293b; border-radius: 8px; padding: 16px; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          td, th { padding: 8px; border-bottom: 1px solid #334155; text-align: left; }
        </style></head><body>
        <h1>🔍 OSINT Find Profiles — Live Test</h1>
        <div>
          <input id="q" value="deptraidapxichlo" style="width: 300px;" />
          <select id="type">
            <option value="auto">auto</option>
            <option value="username" selected>username</option>
            <option value="name">name</option>
            <option value="phone">phone</option>
            <option value="email">email</option>
          </select>
          <input id="platforms" placeholder="platforms (csv)" style="width: 400px;"
            value="twitter,threads,bluesky,mastodon,reddit,medium,instagram,tiktok,linkedin,youtube" />
          <button id="go" onclick="search()">Search</button>
        </div>
        <div id="out"></div>
        <script>
          async function search() {
            document.getElementById('out').innerHTML = '<p>⏳ Searching (real network calls, up to 60s)...</p>';
            const platforms = document.getElementById('platforms').value.split(',').map(s => s.trim()).filter(Boolean);
            const res = await fetch('/api/osint/find-profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: document.getElementById('q').value,
                queryType: document.getElementById('type').value,
                platforms,
                timeoutMs: 20000,
              }),
            });
            const data = await res.json();
            let html = '<h2>Results for "' + data.query + '" (' + data.queryType + ')</h2>';
            html += '<p>Total profiles: <strong>' + data.totalProfiles + '</strong> | Duration: ' + data.durationMs + 'ms</p>';
            html += '<h3>Platform Status</h3>';
            for (const s of data.platformStatus) {
              const cls = s.status === 'ok' ? 'ok' : (s.status === 'skipped' || s.status === 'account_sick' ? 'skipped' : 'error');
              html += '<span class="status ' + cls + '" id="st-' + s.platform + '">' + s.platform + ': ' + s.status + ' (' + s.durationMs + 'ms)' + (s.error ? ' — ' + s.error.category : '') + '</span>';
            }
            if (data.profiles && data.profiles.length) {
              html += '<h3>Profiles Found</h3>';
              for (const p of data.profiles) {
                html += '<div class="profile"><strong>' + (p.name || p.username) + '</strong> @' + p.username + ' <span class="status ok">' + p.platform + '</span><br/>' + (p.bio || '') + '<br/><a style="color:#38bdf8" href="' + (p.profileUrl || '#') + '">' + (p.profileUrl || '') + '</a></div>';
              }
            }
            document.getElementById('out').innerHTML = html;
          }
        </script></body></html>
      `
    });
  });

  await page.goto('http://127.0.0.1:12349/');
  console.log('🔍 Searching OSINT for "deptraidapxichlo" (username) across 10 platforms...');
  await page.click('#go');
  await page.waitForSelector('#st-twitter', { timeout: 90000 });

  for (const p of ['twitter','threads','bluesky','mastodon','reddit','medium','instagram','tiktok','linkedin','youtube']) {
    const el = await page.$('#st-' + p);
    if (el) console.log('  ', await el.textContent());
  }

  const bodyText = await page.textContent('body');
  const totalMatch = bodyText.match(/Total profiles: (\d+)/);
  console.log('\n📊 Total profiles found:', totalMatch ? totalMatch[1] : 'unknown');

  await page.screenshot({ path: 'tests/osint-deptrai-live.png', fullPage: true });
  console.log('📸 Screenshot: tests/osint-deptrai-live.png');

  await browser.close();
  server.close();
  process.exit(0);
});
