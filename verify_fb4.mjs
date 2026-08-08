import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Mobile/15E148 Safari/604.1');

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

await page.goto('https://www.facebook.com/zuck/posts/pfbid0346bEmC8Di4gyDPfuiMnS73ZyuiRUyvoHwE4CR9fbVaPVPfW1SXk9Q3sjKmd8mKR6l', {
  waitUntil: 'networkidle2',
  timeout: 30000
});

await new Promise(r => setTimeout(r, 5000));

// Get page diagnostics
const diag = await page.evaluate(() => {
  return {
    url: window.location.href,
    title: document.title,
    // Check for login elements
    hasLoginForm: !!document.querySelector('form[action*="login"]'),
    // Check for error messages
    bodyText: document.body?.innerText?.substring(0, 500) || 'no body',
    // Check for specific Facebook elements
    hasStories: document.body?.innerText?.includes('Stories') || false,
    hasFeed: document.body?.innerText?.includes('feed') || false,
    // Count all aria-labels
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
    // Get first few aria-labels
    firstAriaLabels: Array.from(document.querySelectorAll('[aria-label]')).slice(0, 10).map(el => el.getAttribute('aria-label'))
  };
});

console.log(JSON.stringify(diag, null, 2));

await browser.close();
