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

const cookies = [
  { name: 'c_user', value: '61590064244856', domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: '28:IozFmK0ZxRc0QA:2:1784813151:-1:-1:AcxmMAvaef423d9NH1k-k9GZg54Xn7jv6ArAn-Ba5WrB', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: 'GRZiamd038uppbXzmaHFAvwj', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: 'GhZiah6ZnKyzonT4_VLPWhHA', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: '1OeYlXybhAcKnXnOo.AWc8h_VgvezH1ppa0uD0dXp359mPdb6Nwrj6neJIBhYCO8fEzQ8.Bqd2mc..AAA.0.0.Bqd2mc.AWdQfrXW4X6bNtSz060jSIRx8Fw', domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

await page.goto('https://www.facebook.com/groups/opensource/members', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

// Find all links that look like profile links
const members = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('a[href*="/groups/opensource/members/"]').forEach(a => {
    const name = a.textContent.trim();
    const href = a.getAttribute('href');
    if (name && href && name.length > 1) {
      results.push({ name, href });
    }
  });
  
  // Also try other patterns
  document.querySelectorAll('a[href*="/profile.php"], a[href*="/"]').forEach(a => {
    const name = a.textContent.trim();
    const href = a.getAttribute('href');
    if (name && href && name.length > 1 && name.length < 50 && href.includes('/')) {
      results.push({ name, href });
    }
  });
  
  return results.slice(0, 20);
});

console.log("Members found:", JSON.stringify(members, null, 2));

// Check for "Members" section
const sectionCheck = await page.evaluate(() => {
  const sections = [];
  document.querySelectorAll('span, div').forEach(el => {
    const text = el.textContent.trim();
    if (text === 'Members' || text.includes('members')) {
      const parent = el.parentElement;
      sections.push({
        text: text.substring(0, 30),
        className: el.className?.substring(0, 50) || '',
        parentTag: parent?.tagName || ''
      });
    }
  });
  return sections.slice(0, 10);
});

console.log("\nMembers sections:", JSON.stringify(sectionCheck, null, 2));

await browser.close();
