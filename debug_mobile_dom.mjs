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
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');

await page.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1000));

const cookies = [
  { name: 'c_user', value: COOKIE.c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  { name: 'xs', value: COOKIE.xs, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'datr', value: COOKIE.datr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'sb', value: COOKIE.sb, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
  { name: 'fr', value: COOKIE.fr, domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
];
for (const c of cookies) { try { await page.setCookie(c); } catch(e) {} }

await page.goto('https://m.facebook.com/groups/opensource', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 5000));

const r = await page.evaluate(() => {
  const results = {};
  const dataElements = document.querySelectorAll('[data-sigil]');
  results.sigils = Array.from(dataElements).slice(0, 15).map(el => ({
    tag: el.tagName,
    sigil: el.getAttribute('data-sigil')
  }));

  const storyDivs = document.querySelectorAll('[data-sigil="story-div"]');
  results.storyDivs = storyDivs.length;

  const allDivs = document.querySelectorAll('div');
  const postCandidates = [];
  for (const div of allDivs) {
    const text = div.innerText?.trim();
    if (text && text.length > 30 && text.length < 1000 && div.children.length >= 3) {
      if (/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Thg)/i.test(text)) {
        postCandidates.push({
          className: div.className?.substring(0, 80),
          textPreview: text.substring(0, 200)
        });
      }
    }
    if (postCandidates.length >= 5) break;
  }
  results.postCandidates = postCandidates;
  return results;
});

console.log('=== Mobile DOM Structure ===');
console.log(`\nSigils found: ${r.sigils.length}`);
r.sigils.forEach(s => console.log(`  ${s.sigil} (${s.tag})`));

console.log(`\nStory divs: ${r.storyDivs}`);

console.log(`\nPost candidates: ${r.postCandidates.length}`);
r.postCandidates.forEach((p, i) => {
  console.log(`\n[${i}] class=${p.className}`);
  console.log(`    text: ${p.textPreview?.substring(0, 150)}`);
});

await browser.close();
