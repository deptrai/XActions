import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Mobile/15E148 Safari/604.1');

// Set cookies
const cookies = [
  { name: 'c_user', value: '61585953024202', domain: '.facebook.com', path: '/' },
  { name: 'xs', value: '24%3AXYxw6HA_sdH0FA%3A2%3A1785523930%3A-1%3A-1', domain: '.facebook.com', path: '/' },
  { name: 'sb', value: 'ZC1TaZqKp1KbJyPstz7kHfJS', domain: '.facebook.com', path: '/' },
  { name: 'datr', value: 'Mi1TaakeFZ1XRsBBkXTdJxgs', domain: '.facebook.com', path: '/' },
  { name: 'fr', value: '18kjk5J56lZxYqvgO.AWcljr9xo117xeKt5hf9aZgCGbRlxmo8d6_i2OGWok0vjhZo_Ac.BqDXfo..AAA.0.0.BqbPB1.AWdFBlHrgie9xh_tBOzMDl0QWdw', domain: '.facebook.com', path: '/' },
  { name: 'fbl_st', value: '101728416%3BT%3A29758739', domain: '.facebook.com', path: '/' },
  { name: 'locale', value: 'en_GB', domain: '.facebook.com', path: '/' },
];
await browser.setCookie(...cookies);

// Navigate to post with cache bypass
await page.goto('https://www.facebook.com/zuck/posts/pfbid0346bEmC8Di4gyDPfuiMnS73ZyuiRUyvoHwE4CR9fbVaPVPfW1SXk9Q3sjKmd8mKR6l?ref=external&_rdr', {
  waitUntil: 'networkidle2',
  timeout: 30000
});

await new Promise(r => setTimeout(r, 4000));

// Check for like status using multiple methods
const result = await page.evaluate(() => {
  const result = { methods: [] };
  
  // Method 1: Check aria-label containing Like/Unlike
  const all = document.querySelectorAll('[aria-label]');
  all.forEach(el => {
    const label = el.getAttribute('aria-label');
    if (label && (label.toLowerCase().includes('like') || label.toLowerCase().includes('unlike'))) {
      result.methods.push({ method: 'aria-label', label });
    }
  });
  
  // Method 2: Check for svg with blue fill (liked state)
  const svgs = document.querySelectorAll('svg');
  svgs.forEach((s, i) => {
    const fill = s.getAttribute('fill');
    if (fill && (fill === '#1877f2' || fill === 'rgb(24, 119, 242)')) {
      result.methods.push({ method: 'svg-fill', fill, index: i });
    }
  });
  
  // Method 3: Check role="button" with specific text
  const buttons = document.querySelectorAll('[role="button"]');
  buttons.forEach(b => {
    const text = b.innerText || b.textContent;
    if (text && (text.trim() === 'Like' || text.trim() === 'Unlike')) {
      result.methods.push({ method: 'button-text', text: text.trim() });
    }
  });
  
  // Method 4: Check data-testid
  const testIds = document.querySelectorAll('[data-testid]');
  testIds.forEach(el => {
    const testId = el.getAttribute('data-testid');
    if (testId && testId.toLowerCase().includes('like')) {
      result.methods.push({ method: 'data-testid', testId });
    }
  });
  
  // Method 5: Check for "You reacted" or similar
  const bodyText = document.body.innerText;
  if (bodyText.includes('You reacted') || bodyText.includes('You and')) {
    result.methods.push({ method: 'body-text', found: true });
  }
  
  return result;
});

console.log('=== Verification Results ===');
console.log(JSON.stringify(result, null, 2));

// Get page title to confirm we're on the right page
const title = await page.title();
console.log('\nPage title:', title);

await browser.close();
