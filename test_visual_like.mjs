import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3628.309 Safari/537.36');

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await new Promise(r => setTimeout(r, 1000));

const cookies = [
  { name: 'ps_l', value: '1', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  { name: 'datr', value: 'GRZiamd038uppbXzmaHFAvwj', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: '1Tk70QIWUv8IncpTm.AWffp8q5AKtYgkGyjCNQngzczQvfQdBFVIMKv3gbLhWVvUYymxI.Bqd2Fl..AAA.0.0.Bqd2Fl.AWdWvlZ1RNoeDaMxBFsT3uWnlNU', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'xs', value: '28%3AIozFmK0ZxRc0QA%3A2%3A1784813151%3A-1%3A-1%3A%3AAcxTRlmmi33__rHb7azMLUyihACA1mpgZOFJZm696nTz', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'c_user', value: '61590064244856', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'ps_n', value: '1', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: 'GhZiah6ZnKyzonT4_VLPWhHA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'wd', value: '1143x683', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

await page.goto('https://www.facebook.com/zuck/posts/pfbid0346bEmC8Di4gyDPfuiMnS73ZyuiRUyvoHwE4CR9fbVaPVPfW1SXk9Q3sjKmd8mKR6l', { waitUntil: 'networkidle2', timeout: 15000 });
await new Promise(r => setTimeout(r, 4000));

// Take screenshot
await page.screenshot({ path: '/tmp/fb_post_page.png', fullPage: false });

// Check all Like/Unlike buttons
const allBtns = await page.evaluate(() => {
  const results = [];
  const btns = document.querySelectorAll('[role="button"], button, [class*="Like"], [data-testid*="like"]');
  btns.forEach(b => {
    const label = b.getAttribute('aria-label') || '';
    const text = b.textContent || '';
    const rect = b.getBoundingClientRect();
    if (label.includes('Like') || label.includes('Reaction') || text === 'Like' || text === 'Thích') {
      results.push({
        label: label.substring(0, 50),
        text: text.substring(0, 30),
        tag: b.tagName,
        className: b.className?.substring(0, 50) || '',
        x: rect.x + rect.width/2,
        y: rect.y + rect.height/2,
        w: rect.width,
        h: rect.height,
        visible: rect.top >= 0 && rect.top < window.innerHeight && rect.width > 0
      });
    }
  });
  return results;
});

console.log("All Like-related buttons:");
console.log(JSON.stringify(allBtns, null, 2));

await new Promise(r => setTimeout(r, 30000));
await browser.close();
