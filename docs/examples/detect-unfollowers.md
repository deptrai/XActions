# 🔍 Detect Unfollowers

Track who unfollowed you over time on X (Twitter).

---

## 📋 What It Does

This feature helps you monitor your follower changes by:

1. **Taking snapshots** - Saves your current followers list with timestamps
2. **Comparing over time** - Detects who unfollowed since your last check
3. **Tracking new followers** - Also shows who started following you
4. **Persistent storage** - Data survives browser restarts (localStorage/JSON files)

**Use cases:**
- Find out who unfollowed you after a tweet
- Monitor follower health over time
- Identify fake followers who follow/unfollow
- Keep records of your audience changes
- Detect mass unfollows from bot accounts

---

## 🌐 Example 1: Browser Console (Quick)

**Best for:** Quick checks from your browser, no setup needed

**Steps:**
1. Go to `x.com/YOUR_USERNAME/followers`
2. Open browser console (F12 → Console tab)
3. Paste the script below and press Enter
4. Run again later to detect changes!

```javascript
// ============================================
// Medirus - Detect Unfollowers (Browser Console)
// Author: nich (@nichxbt)
// Go to: x.com/YOUR_USERNAME/followers
// Open console (F12), paste this
// ============================================

(async () => {
  // Configuration
  const STORAGE_KEY = 'medirus_followers_snapshot';
  const SCROLL_DELAY = 1500;         // Time between scrolls (ms)
  const MAX_SCROLL_RETRIES = 10;     // Stop if no new users found
  
  console.log('🔍 Medirus - Detect Unfollowers');
  console.log('=================================');
  
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  // Verify we're on the followers page
  const pathMatch = window.location.pathname.match(/^\/([^/]+)\/followers/);
  if (!pathMatch) {
    console.error('❌ Please navigate to your FOLLOWERS page first!');
    console.log('👉 Go to: x.com/YOUR_USERNAME/followers');
    return;
  }
  
  const username = pathMatch[1];
  console.log(`📍 Monitoring: @${username}`);
  console.log('');
  
  // Step 1: Scrape current followers
  console.log('📜 Step 1: Scanning your followers list...');
  
  const followers = new Map();
  let scrollRetries = 0;
  
  while (scrollRetries < MAX_SCROLL_RETRIES) {
    const cells = document.querySelectorAll('[data-testid="UserCell"]');
    const prevSize = followers.size;
    
    cells.forEach(cell => {
      try {
        // Get username from link
        const link = cell.querySelector('a[href^="/"]');
        const href = link?.getAttribute('href') || '';
        const handle = href.split('/')[1]?.toLowerCase();
        
        if (!handle || handle.includes('?') || handle.includes('/')) return;
        
        // Get display name
        const nameEl = cell.querySelector('[dir="ltr"] > span');
        const displayName = nameEl?.textContent?.trim() || handle;
        
        // Get bio
        const bioEl = cell.querySelector('[data-testid="UserDescription"]');
        const bio = bioEl?.textContent?.trim() || null;
        
        if (!followers.has(handle)) {
          followers.set(handle, {
            username: handle,
            displayName,
            bio,
            scrapedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        // Skip malformed cells
      }
    });
    
    console.log(`   📊 Found ${followers.size} followers so far...`);
    
    // Check if we're stuck
    if (followers.size === prevSize) {
      scrollRetries++;
    } else {
      scrollRetries = 0;
    }
    
    // Scroll to load more
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(SCROLL_DELAY);
  }
  
  const currentFollowers = Array.from(followers.values());
  console.log('');
  console.log(`✅ Scan complete! Found ${currentFollowers.length} followers`);
  
  // Step 2: Load previous snapshot
  console.log('');
  console.log('📂 Step 2: Checking for previous snapshot...');
  
  let previousData = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      previousData = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('   ⚠️ Could not load previous data:', e.message);
  }
  
  // Step 3: Compare and show results
  if (previousData && previousData.username === username) {
    console.log(`   📸 Found snapshot from ${new Date(previousData.timestamp).toLocaleString()}`);
    console.log(`   📊 Previous count: ${previousData.count}`);
    console.log(`   📊 Current count: ${currentFollowers.length}`);
    console.log('');
    console.log('🔎 Step 3: Comparing snapshots...');
    
    // Create sets for comparison
    const prevUsernames = new Set(previousData.followers.map(f => f.username.toLowerCase()));
    const currUsernames = new Set(currentFollowers.map(f => f.username.toLowerCase()));
    
    // Find unfollowers (were in previous, not in current)
    const unfollowers = previousData.followers.filter(
      f => !currUsernames.has(f.username.toLowerCase())
    );
    
    // Find new followers (in current, not in previous)
    const newFollowers = currentFollowers.filter(
      f => !prevUsernames.has(f.username.toLowerCase())
    );
    
    // Display unfollowers
    console.log('');
    if (unfollowers.length > 0) {
      console.log(`🚨 ${unfollowers.length} PEOPLE UNFOLLOWED YOU:`);
      console.log('─'.repeat(40));
      unfollowers.forEach((u, i) => {
        console.log(`   ${i + 1}. @${u.username} (${u.displayName})`);
        console.log(`      └─ https://x.com/${u.username}`);
      });
      
      // Download unfollowers list
      const unfollowersList = unfollowers.map(u => `@${u.username}`).join('\n');
      const blob = new Blob([unfollowersList], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unfollowers-${new Date().toISOString().split('T')[0]}.txt`;
      a.click();
      console.log('');
      console.log('📥 Downloaded unfollowers list!');
    } else {
      console.log('✨ No one unfollowed you since last check!');
    }
    
    // Display new followers
    console.log('');
    if (newFollowers.length > 0) {
      console.log(`🎉 ${newFollowers.length} NEW FOLLOWERS:`);
      console.log('─'.repeat(40));
      newFollowers.slice(0, 20).forEach((u, i) => {
        console.log(`   ${i + 1}. @${u.username} (${u.displayName})`);
      });
      if (newFollowers.length > 20) {
        console.log(`   ... and ${newFollowers.length - 20} more!`);
      }
    } else {
      console.log('📭 No new followers since last check.');
    }
    
    // Summary
    console.log('');
    console.log('📈 SUMMARY:');
    console.log('─'.repeat(40));
    const netChange = newFollowers.length - unfollowers.length;
    const changeIcon = netChange > 0 ? '📈' : netChange < 0 ? '📉' : '➡️';
    console.log(`   ${changeIcon} Net change: ${netChange >= 0 ? '+' : ''}${netChange} followers`);
    console.log(`   ➕ Gained: ${newFollowers.length}`);
    console.log(`   ➖ Lost: ${unfollowers.length}`);
    
  } else {
    console.log('   📸 No previous snapshot found (first run)');
    console.log('   💡 Run this script again later to detect changes!');
  }
  
  // Step 4: Save current snapshot
  console.log('');
  console.log('💾 Step 4: Saving current snapshot...');
  
  const snapshot = {
    username,
    followers: currentFollowers,
    count: currentFollowers.length,
    timestamp: new Date().toISOString()
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  console.log(`   ✅ Saved ${currentFollowers.length} followers`);
  console.log(`   📅 Timestamp: ${new Date().toLocaleString()}`);
  
  // Final message
  console.log('');
  console.log('═'.repeat(50));
  console.log('🔄 Run this script again anytime to detect changes!');
  console.log('💡 Tip: Bookmark this script for easy access');
  console.log('═'.repeat(50));
  
  // Return data for further use
  return {
    username,
    currentCount: currentFollowers.length,
    unfollowers: previousData ? 
      previousData.followers.filter(f => 
        !new Set(currentFollowers.map(c => c.username)).has(f.username)
      ) : [],
    newFollowers: previousData ? 
      currentFollowers.filter(f => 
        !new Set(previousData.followers.map(p => p.username)).has(f.username)
      ) : [],
    snapshot
  };
})();
```

**What happens:**
1. Script scrolls through your followers list
2. Collects all follower usernames and display names
3. Saves snapshot to localStorage with timestamp
4. On subsequent runs, compares with previous snapshot
5. Shows who unfollowed and who's new
6. Downloads a text file of unfollowers

**Output example:**
```
🔍 Medirus - Detect Unfollowers
=================================
📍 Monitoring: @nichxbt

📜 Step 1: Scanning your followers list...
   📊 Found 156 followers so far...
   📊 Found 312 followers so far...
   📊 Found 489 followers so far...

✅ Scan complete! Found 489 followers

📂 Step 2: Checking for previous snapshot...
   📸 Found snapshot from 12/28/2025, 3:45:00 PM
   📊 Previous count: 495
   📊 Current count: 489

🔎 Step 3: Comparing snapshots...

🚨 8 PEOPLE UNFOLLOWED YOU:
────────────────────────────────────────
   1. @spammer123 (Spam Bot)
      └─ https://x.com/spammer123
   2. @fakefollower (Fake Account)
      └─ https://x.com/fakefollower
   ...

📥 Downloaded unfollowers list!

🎉 2 NEW FOLLOWERS:
────────────────────────────────────────
   1. @genuine_user (Real Person)
   2. @newbie2025 (New User)

📈 SUMMARY:
────────────────────────────────────────
   📉 Net change: -6 followers
   ➕ Gained: 2
   ➖ Lost: 8

💾 Step 4: Saving current snapshot...
   ✅ Saved 489 followers
   📅 Timestamp: 1/1/2026, 10:30:00 AM

══════════════════════════════════════════════════
🔄 Run this script again anytime to detect changes!
💡 Tip: Bookmark this script for easy access
══════════════════════════════════════════════════
```

---

## 🖥️ Example 2: Node.js with Puppeteer (Production)

**Best for:** Automated daily checks, large follower lists, historical tracking

**Features:**
- Saves snapshots to JSON files with dates
- Keeps historical records
- Compare any two snapshots
- Export detailed reports
- Perfect for scheduling with cron

### Setup

```bash
# Create project folder
mkdir unfollower-tracker && cd unfollower-tracker

# Initialize and install dependencies
npm init -y
npm install puppeteer
```

### Main Script: `detect-unfollowers.js`

```javascript
// ============================================
// Medirus - Detect Unfollowers (Node.js + Puppeteer)
// Author: nich (@nichxbt)
// 
// Usage:
//   node detect-unfollowers.js scrape <username>
//   node detect-unfollowers.js compare <file1> <file2>
//   node detect-unfollowers.js check <username>
// ============================================

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  headless: true,                    // Set to false to see browser
  scrollDelay: 2000,                 // Time between scrolls (ms)
  maxRetries: 15,                    // Max scroll retries before stopping
  snapshotDir: './snapshots',        // Where to save snapshot files
  userDataDir: './browser-data',     // Persistent browser session
  viewport: { width: 1280, height: 800 }
};

// Ensure directories exist
if (!fs.existsSync(CONFIG.snapshotDir)) {
  fs.mkdirSync(CONFIG.snapshotDir, { recursive: true });
}
if (!fs.existsSync(CONFIG.userDataDir)) {
  fs.mkdirSync(CONFIG.userDataDir, { recursive: true });
}

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Get today's date string for filenames
 */
const getDateString = () => {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
};

/**
 * Launch browser with persistent session
 */
async function launchBrowser() {
  return await puppeteer.launch({
    headless: CONFIG.headless,
    userDataDir: CONFIG.userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
}

/**
 * Check if user is logged in to X/Twitter
 */
async function checkLogin(page) {
  await page.goto('https://x.com/home', { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });
  
  // Check for login indicators
  const isLoggedIn = await page.evaluate(() => {
    // Look for compose tweet button or profile link
    return !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
           !!document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  });
  
  return isLoggedIn;
}

/**
 * Prompt user to log in manually
 */
async function manualLogin(page) {
  console.log('\n🔐 Login Required');
  console.log('═'.repeat(50));
  console.log('1. A browser window will open');
  console.log('2. Log in to your X/Twitter account');
  console.log('3. Press Enter here when done');
  console.log('═'.repeat(50));
  
  // Open login page in visible browser
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: CONFIG.userDataDir,
    args: ['--no-sandbox']
  });
  
  const loginPage = await browser.newPage();
  await loginPage.goto('https://x.com/login', { waitUntil: 'networkidle2' });
  
  // Wait for user to press Enter
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  await browser.close();
  console.log('✅ Login saved! You can now run in headless mode.\n');
}

/**
 * Scrape followers list for a username
 */
async function scrapeFollowers(username) {
  console.log(`\n🔍 Scraping followers for @${username}`);
  console.log('─'.repeat(50));
  
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport(CONFIG.viewport);
  
  try {
    // Check login status
    const isLoggedIn = await checkLogin(page);
    if (!isLoggedIn) {
      await browser.close();
      console.log('❌ Not logged in to X/Twitter');
      await manualLogin(page);
      // Retry with new browser instance
      return await scrapeFollowers(username);
    }
    
    console.log('✅ Logged in to X/Twitter');
    
    // Navigate to followers page
    console.log(`📍 Navigating to @${username}/followers...`);
    await page.goto(`https://x.com/${username}/followers`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for content to load
    await sleep(3000);
    
    // Check if page exists
    const pageError = await page.evaluate(() => {
      return document.body.innerText.includes("This account doesn't exist") ||
             document.body.innerText.includes("Account suspended");
    });
    
    if (pageError) {
      throw new Error(`Account @${username} not found or suspended`);
    }
    
    // Scrape followers with scrolling
    console.log('📜 Scanning followers list...');
    
    const followers = new Map();
    let retries = 0;
    let lastHeight = 0;
    
    while (retries < CONFIG.maxRetries) {
      // Extract visible followers
      const newFollowers = await page.evaluate(() => {
        const users = [];
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        
        cells.forEach(cell => {
          try {
            const link = cell.querySelector('a[href^="/"]');
            const href = link?.getAttribute('href') || '';
            const username = href.split('/')[1]?.toLowerCase();
            
            if (!username || username.includes('?') || username.includes('/')) return;
            
            const nameEl = cell.querySelector('[dir="ltr"] > span');
            const displayName = nameEl?.textContent?.trim() || username;
            
            const bioEl = cell.querySelector('[data-testid="UserDescription"]');
            const bio = bioEl?.textContent?.trim() || null;
            
            const verified = !!cell.querySelector('svg[aria-label*="Verified"]');
            
            users.push({ username, displayName, bio, verified });
          } catch (e) {
            // Skip malformed cells
          }
        });
        
        return users;
      });
      
      // Add to map (deduplicates)
      const prevSize = followers.size;
      newFollowers.forEach(f => {
        if (!followers.has(f.username)) {
          followers.set(f.username, f);
        }
      });
      
      console.log(`   📊 Found ${followers.size} followers...`);
      
      // Check if stuck
      if (followers.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }
      
      // Scroll down
      const currentHeight = await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return document.body.scrollHeight;
      });
      
      if (currentHeight === lastHeight) {
        retries++;
      }
      lastHeight = currentHeight;
      
      await sleep(CONFIG.scrollDelay);
    }
    
    const followersList = Array.from(followers.values());
    console.log(`\n✅ Scraping complete! Found ${followersList.length} followers`);
    
    // Create snapshot
    const snapshot = {
      username,
      followers: followersList,
      count: followersList.length,
      timestamp: new Date().toISOString(),
      scrapedAt: getDateString()
    };
    
    // Save to file
    const filename = `${username}-${getDateString()}.json`;
    const filepath = path.join(CONFIG.snapshotDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
    
    console.log(`💾 Saved snapshot: ${filepath}`);
    
    return snapshot;
    
  } finally {
    await browser.close();
  }
}

/**
 * Compare two snapshot files and show differences
 */
function compareSnapshots(file1, file2) {
  console.log('\n🔎 Comparing Snapshots');
  console.log('═'.repeat(50));
  
  // Load snapshots
  let snapshot1, snapshot2;
  
  try {
    const path1 = file1.includes('/') ? file1 : path.join(CONFIG.snapshotDir, file1);
    const path2 = file2.includes('/') ? file2 : path.join(CONFIG.snapshotDir, file2);
    
    snapshot1 = JSON.parse(fs.readFileSync(path1, 'utf-8'));
    snapshot2 = JSON.parse(fs.readFileSync(path2, 'utf-8'));
  } catch (e) {
    console.error(`❌ Error loading snapshots: ${e.message}`);
    return null;
  }
  
  console.log(`📅 Older: ${snapshot1.scrapedAt} (${snapshot1.count} followers)`);
  console.log(`📅 Newer: ${snapshot2.scrapedAt} (${snapshot2.count} followers)`);
  console.log('');
  
  // Create username sets
  const users1 = new Set(snapshot1.followers.map(f => f.username));
  const users2 = new Set(snapshot2.followers.map(f => f.username));
  
  // Find differences
  const unfollowers = snapshot1.followers.filter(f => !users2.has(f.username));
  const newFollowers = snapshot2.followers.filter(f => !users1.has(f.username));
  
  // Display unfollowers
  if (unfollowers.length > 0) {
    console.log(`🚨 ${unfollowers.length} UNFOLLOWED YOU:`);
    console.log('─'.repeat(40));
    unfollowers.forEach((u, i) => {
      const verified = u.verified ? ' ✓' : '';
      console.log(`   ${i + 1}. @${u.username}${verified} — ${u.displayName}`);
    });
    console.log('');
  } else {
    console.log('✨ No one unfollowed!\n');
  }
  
  // Display new followers
  if (newFollowers.length > 0) {
    console.log(`🎉 ${newFollowers.length} NEW FOLLOWERS:`);
    console.log('─'.repeat(40));
    newFollowers.forEach((u, i) => {
      const verified = u.verified ? ' ✓' : '';
      console.log(`   ${i + 1}. @${u.username}${verified} — ${u.displayName}`);
    });
    console.log('');
  } else {
    console.log('📭 No new followers.\n');
  }
  
  // Summary
  console.log('📈 SUMMARY:');
  console.log('─'.repeat(40));
  const netChange = newFollowers.length - unfollowers.length;
  const changeIcon = netChange > 0 ? '📈' : netChange < 0 ? '📉' : '➡️';
  console.log(`   ${changeIcon} Net change: ${netChange >= 0 ? '+' : ''}${netChange}`);
  console.log(`   ➕ Gained: ${newFollowers.length}`);
  console.log(`   ➖ Lost: ${unfollowers.length}`);
  console.log(`   📊 Previous: ${snapshot1.count} → Current: ${snapshot2.count}`);
  
  // Save report
  const report = {
    comparedAt: new Date().toISOString(),
    older: { file: file1, date: snapshot1.scrapedAt, count: snapshot1.count },
    newer: { file: file2, date: snapshot2.scrapedAt, count: snapshot2.count },
    unfollowers,
    newFollowers,
    netChange
  };
  
  const reportFile = path.join(CONFIG.snapshotDir, `report-${getDateString()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n💾 Report saved: ${reportFile}`);
  
  return report;
}

/**
 * Quick check - scrape and compare with most recent snapshot
 */
async function quickCheck(username) {
  console.log(`\n🚀 Quick Check for @${username}`);
  console.log('═'.repeat(50));
  
  // Find most recent snapshot for this user
  const files = fs.readdirSync(CONFIG.snapshotDir)
    .filter(f => f.startsWith(`${username}-`) && f.endsWith('.json'))
    .sort()
    .reverse();
  
  const previousFile = files[0];
  
  if (previousFile) {
    console.log(`📂 Found previous snapshot: ${previousFile}`);
  } else {
    console.log('📸 First time checking this account');
  }
  
  // Scrape current followers
  const currentSnapshot = await scrapeFollowers(username);
  
  // Compare if we have a previous snapshot
  if (previousFile && previousFile !== `${username}-${getDateString()}.json`) {
    console.log('\n');
    compareSnapshots(previousFile, `${username}-${getDateString()}.json`);
  } else if (previousFile) {
    console.log('\n⚠️  Already scraped today. Compare with an older snapshot:');
    files.slice(0, 5).forEach(f => console.log(`   • ${f}`));
  }
  
  return currentSnapshot;
}

/**
 * List all snapshots for a user
 */
function listSnapshots(username) {
  console.log(`\n📁 Snapshots for @${username || 'all users'}`);
  console.log('═'.repeat(50));
  
  const files = fs.readdirSync(CONFIG.snapshotDir)
    .filter(f => {
      if (!f.endsWith('.json')) return false;
      if (username) return f.startsWith(`${username}-`);
      return !f.startsWith('report-');
    })
    .sort()
    .reverse();
  
  if (files.length === 0) {
    console.log('   No snapshots found.');
    return;
  }
  
  files.forEach(f => {
    const data = JSON.parse(fs.readFileSync(path.join(CONFIG.snapshotDir, f), 'utf-8'));
    console.log(`   📸 ${f}`);
    console.log(`      └─ ${data.count} followers @ ${data.timestamp}`);
  });
}

// ============================================
// CLI Handler
// ============================================

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  console.log('\n🔍 Medirus - Unfollower Detector');
  console.log('═'.repeat(50));
  
  switch (command) {
    case 'scrape':
      if (!args[1]) {
        console.log('Usage: node detect-unfollowers.js scrape <username>');
        process.exit(1);
      }
      await scrapeFollowers(args[1].replace('@', ''));
      break;
      
    case 'compare':
      if (!args[1] || !args[2]) {
        console.log('Usage: node detect-unfollowers.js compare <older.json> <newer.json>');
        console.log('\nAvailable snapshots:');
        listSnapshots();
        process.exit(1);
      }
      compareSnapshots(args[1], args[2]);
      break;
      
    case 'check':
      if (!args[1]) {
        console.log('Usage: node detect-unfollowers.js check <username>');
        process.exit(1);
      }
      await quickCheck(args[1].replace('@', ''));
      break;
      
    case 'list':
      listSnapshots(args[1]?.replace('@', ''));
      break;
      
    default:
      console.log('Commands:');
      console.log('  scrape <username>           Scrape and save followers');
      console.log('  compare <file1> <file2>     Compare two snapshots');
      console.log('  check <username>            Scrape and compare with latest');
      console.log('  list [username]             List saved snapshots');
      console.log('');
      console.log('Examples:');
      console.log('  node detect-unfollowers.js scrape nichxbt');
      console.log('  node detect-unfollowers.js check nichxbt');
      console.log('  node detect-unfollowers.js compare nichxbt-2025-12-25.json nichxbt-2026-01-01.json');
  }
}

main().catch(console.error);
```

### Usage Examples

```bash
# First run - scrape and save your followers
node detect-unfollowers.js scrape nichxbt

# Output:
# 🔍 Scraping followers for @nichxbt
# ──────────────────────────────────────────────────
# ✅ Logged in to X/Twitter
# 📍 Navigating to @nichxbt/followers...
# 📜 Scanning followers list...
#    📊 Found 156 followers...
#    📊 Found 312 followers...
#    📊 Found 489 followers...
# 
# ✅ Scraping complete! Found 489 followers
# 💾 Saved snapshot: ./snapshots/nichxbt-2026-01-01.json
```

```bash
# Later - quick check (scrapes and compares automatically)
node detect-unfollowers.js check nichxbt

# Output includes unfollowers and new followers!
```

```bash
# Compare two specific snapshots
node detect-unfollowers.js compare nichxbt-2025-12-25.json nichxbt-2026-01-01.json
```

```bash
# List all saved snapshots
node detect-unfollowers.js list nichxbt
```

---

## ⏰ Scheduling Tips

Run the script automatically to track changes over time.

### Linux/Mac (Cron)

```bash
# Edit crontab
crontab -e

# Add daily check at 9am
0 9 * * * cd /path/to/unfollower-tracker && node detect-unfollowers.js check nichxbt >> /var/log/unfollowers.log 2>&1

# Add weekly check every Monday at 9am
0 9 * * 1 cd /path/to/unfollower-tracker && node detect-unfollowers.js check nichxbt >> /var/log/unfollowers.log 2>&1
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task → "Unfollower Check"
3. Trigger: Daily or Weekly
4. Action: Start a program
   - Program: `node`
   - Arguments: `detect-unfollowers.js check nichxbt`
   - Start in: `C:\path\to\unfollower-tracker`

### Using PM2 (Node.js Process Manager)

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'unfollower-check',
    script: 'detect-unfollowers.js',
    args: 'check nichxbt',
    cron_restart: '0 9 * * *',  // Daily at 9am
    autorestart: false
  }]
};
EOF

# Start the scheduled job
pm2 start ecosystem.config.js
pm2 save
```

---

## 🌐 Website Alternative

Don't want to run scripts? Use **[medirus.online](https://medirus.online)** instead!

### Features:
- ✅ No coding required
- ✅ Automatic daily monitoring
- ✅ Email/push notifications for unfollowers
- ✅ Historical charts and analytics
- ✅ Works on mobile and desktop
- ✅ Secure OAuth login (no password needed)

### How It Works:
1. Visit [medirus.online](https://medirus.online)
2. Connect your X/Twitter account
3. Enable "Unfollower Detection"
4. Get notified whenever someone unfollows!

---

## 💡 Pro Tips

1. **Run consistently** - Same time daily/weekly for accurate tracking
2. **Keep snapshots** - Don't delete old files, they're useful for long-term analysis
3. **Check after tweets** - Controversial posts often trigger unfollows
4. **Look for patterns** - Mass unfollows might indicate bot cleanups by Twitter
5. **Export to spreadsheet** - JSON files can be imported into Excel/Google Sheets

---

## ⚠️ Rate Limits & Safety

- **Browser console:** Safe for up to ~2,000 followers per session
- **Puppeteer:** Can handle 10,000+ with proper delays
- **Don't run too often:** Once daily is plenty, hourly is excessive
- **Account safety:** These scripts only READ data, never write/post

---

## 📚 Related Features

- [Followers Scraping](followers-scraping.md) - Export your complete followers list
- [Following Scraping](following-scraping.md) - Export who you follow
- [Unfollow Non-Followers](unfollow-non-followers.md) - Clean up your following list

---

**Author:** nich ([@nichxbt](https://x.com/nichxbt))  
**Repository:** [github.com/nirholas/XActions](https://github.com/nirholas/XActions)
