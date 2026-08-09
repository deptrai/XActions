import puppeteer from 'puppeteer';

const COOKIE = {
  c_user: '61590064244856',
  xs: '28:IozFmK0ZxRc0QA:2:1784813151:-1:-1:AcxmMAvaef423d9NH1k-k9GZg54Xn7jv6ArAn-Ba5WrB',
  datr: 'GRZiamd038uppbXzmaHFAvwj',
  sb: 'GhZiah6ZnKyzonT4_VLPWhHA',
  fr: '1OeYlXybhAcKnXnOo.AWc8h_VgvezH1ppa0uD0dXp359mPdb6Nwrj6neJIBhYCO8fEzQ8.Bqd2mc..AAA.0.0.Bqd2mc.AWdQfrXW4X6bNtSz060jSIRx8Fw'
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3628.309 Safari/537.36');

await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

const cookies = [
  { name: 'c_user', value: COOKIE.c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: COOKIE.xs, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: COOKIE.datr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: COOKIE.sb, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: COOKIE.fr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

// Navigate to a post
console.log('=== Navigating to post ===');
await page.goto('https://www.facebook.com/groups/opensource/posts/2058028564788480', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 5000));

// Inspect comment-related elements
const result = await page.evaluate(() => {
  const results = {};

  // Check current selectors
  results.writeAComment = !!document.querySelector('[aria-label*="Write a comment"]');
  results.writeACommentPlaceholder = !!document.querySelector('[placeholder*="Write a comment"]');
  results.vietComment = !!document.querySelector('[aria-label*="Viết bình luận"]');

  // Find all contenteditable elements
  const editables = document.querySelectorAll('[contenteditable]');
  results.contentEditables = Array.from(editables).map(el => ({
    tag: el.tagName,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('placeholder'),
    textContent: el.textContent?.substring(0, 50),
    className: el.className?.substring(0, 100)
  }));

  // Find all textareas
  const textareas = document.querySelectorAll('textarea');
  results.textareas = Array.from(textareas).map(el => ({
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('placeholder'),
    name: el.name,
    id: el.id
  }));

  // Find elements with "comment" in aria-label
  const commentElements = document.querySelectorAll('[aria-label*="comment"], [aria-label*="Comment"], [aria-label*="bình luận"], [aria-label*="Bình luận"]');
  results.commentElements = Array.from(commentElements).map(el => ({
    tag: el.tagName,
    ariaLabel: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
    contentEditable: el.getAttribute('contenteditable')
  }));

  // Find divs with role="textbox"
  const textboxes = document.querySelectorAll('[role="textbox"]');
  results.textboxes = Array.from(textboxes).map(el => ({
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('placeholder'),
    contentEditable: el.getAttribute('contenteditable'),
    className: el.className?.substring(0, 80)
  }));

  return results;
});

console.log(`\nWrite a comment (aria-label): ${result.writeAComment}`);
console.log(`Write a comment (placeholder): ${result.writeACommentPlaceholder}`);
console.log(`Vietnamese comment: ${result.vietComment}`);
console.log(`\nContent editable elements: ${result.contentEditables.length}`);
result.contentEditables.forEach((el, i) => {
  console.log(`  [${i}] tag=${el.tag}, role=${el.role}, aria-label=${el.ariaLabel}, placeholder=${el.placeholder}`);
});
console.log(`\nTextareas: ${result.textareas.length}`);
result.textareas.forEach((el, i) => {
  console.log(`  [${i}] aria-label=${el.ariaLabel}, placeholder=${el.placeholder}`);
});
console.log(`\nComment elements: ${result.commentElements.length}`);
result.commentElements.forEach((el, i) => {
  console.log(`  [${i}] tag=${el.tag}, aria-label=${el.ariaLabel}, role=${el.role}`);
});
console.log(`\nTextboxes (role=textbox): ${result.textboxes.length}`);
result.textboxes.forEach((el, i) => {
  console.log(`  [${i}] aria-label=${el.ariaLabel}, placeholder=${el.placeholder}`);
});

await browser.close();
