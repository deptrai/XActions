import puppeteer from 'puppeteer';

const COOKIES = [
  { name: 'c_user', value: '61590064244856', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: '48%3A-vxiobBZqf3qVQ%3A2%3A1786302115%3A-1%3A-1%3A%3AAcxCuIvg82bSik27c5UBYcqMWadR16R1io8rqPx7jA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: 'GRZiamd038uppbXzmaHFAvwj', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: 'GhZiah6ZnKyzonT4_VLPWhHA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: '1lgJkVvrPzA8p8LGQ.AWdsuIWLLIDmfqFgC_gTaLiKx0ACpoBSC10G6IwuRsmhsuDmcLQ.BqeM6t..AAA.0.0.BqeM6t.AWeWGCL3U7d0SO2KRvvi56lNPwE', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

await page.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

for (const c of COOKIES) {
  try { await page.setCookie(c); } catch(e) {}
}

await page.goto('https://m.facebook.com/groups/opensource', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

// Find the actual post container by looking for elements with date patterns (Jul, Aug, etc.)
const result = await page.evaluate(() => {
  // Get all div.m.displayed elements and filter for those with date patterns
  const allDivs = document.querySelectorAll('div.m.displayed');
  const posts = [];

  allDivs.forEach((el) => {
    const text = el.innerText?.trim() || '';
    // Posts have date patterns like "Jul 16", "2h", "3d", etc.
    if (/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+|\d+\s*(min|h|hour|day|week)s?\s*ago/i.test(text)) {
      // This is a real post - extract data
      const links = el.querySelectorAll('a[href]');
      const postLinks = Array.from(links).filter(a => {
        const href = a.getAttribute('href') || '';
        return href.includes('/posts/') || href.includes('/permalink/') || href.includes('story_fbid') || href.includes('/groups/') && href.includes('/posts/');
      });

      posts.push({
        textLen: text.length,
        textPreview: text.substring(0, 300),
        linkCount: postLinks.length,
        firstLink: postLinks[0]?.getAttribute('href') || null
      });
    }
  });

  return {
    totalDivs: allDivs.length,
    postCount: posts.length,
    posts: posts.slice(0, 5)
  };
});

console.log(`Total div.m.displayed: ${result.totalDivs}`);
console.log(`Posts (with dates): ${result.postCount}`);
result.posts.forEach((p, i) => {
  console.log(`\n[${i}] (${p.textLen} chars, ${p.linkCount} links):`);
  console.log(`    ${p.textPreview.substring(0, 200)}`);
  console.log(`    URL: ${p.firstLink}`);
});

await browser.close();
