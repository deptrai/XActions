import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3628.309 Safari/537.36');

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 1000));

// User's cookies
const cookies = [
  { name: 'c_user', value: '61590064244856', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: '28:IozFmK0ZxRc0QA:2:1784813151:-1:-1:AcxTRlmmi33__rHb7azMLUyihACA1mpgZOFJZm696nTz', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: 'GRZiamd038uppbXzmaHFAvwj', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: 'GhZiah6ZnKyzonT4_VLPWhHA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: '1Tk70QIWUv8IncpTm.AWffp8q5AKtYgkGyjCNQngzczQvfQdBFVIMKv3gbLhWVvUYymxI.Bqd2Fl..AAA.0.0.Bqd2Fl.AWdWvlZ1RNoeDaMxBFsT3uWnlNU', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

// Navigate to the same post
await page.goto('https://www.facebook.com/zuck/posts/pfbid0346bEmC8Di4gyDPfuiMnS73ZyuiRUyvoHwE4CR9fbVaPVPfW1SXk9Q3sjKmd8mKR6l', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 4000));

// Check if post is liked now
const result = await page.evaluate(() => {
  const unlike = document.querySelector('[aria-label*="Unlike"]');
  const like = document.querySelector('[aria-label="Like"]');
  return {
    isLiked: !!unlike,
    hasLikeButton: !!like,
    unlikeLabel: unlike?.getAttribute('aria-label') || 'N/A'
  };
});

console.log("=== Verification ===");
console.log(JSON.stringify(result, null, 2));

if (result.isLiked) {
  console.log("\n✅ POST IS LIKED! Automation works!");
} else {
  console.log("\n❌ Post not liked yet (might need more time or Facebook delayed the action)");
}

await browser.close();
