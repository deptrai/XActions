import 'dotenv/config';
import fs from 'node:fs';
import { gotScraping } from 'got-scraping';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}
const cookieHeader = Object.entries(cookieRecord).map(([k, v]) => `${k}=${v}`).join('; ');

async function main() {
  const url = 'https://www.facebook.com/share/p/1EewJwQixN/';
  const resp = await gotScraping({
    url,
    method: 'GET',
    proxyUrl: process.env.PROXY_URL,
    headers: { cookie: cookieHeader },
    timeout: { request: 60000 },
    throwHttpErrors: false,
  });

  console.log('status:', resp.statusCode);
  console.log('url:', resp.url);
  fs.writeFileSync('/tmp/fb-post.html', resp.body);
  console.log('saved to /tmp/fb-post.html, length', resp.body.length);
}

main().catch(console.error);
