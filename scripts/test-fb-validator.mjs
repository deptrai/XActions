import 'dotenv/config';
import fs from 'node:fs';
import { gotScraping } from 'got-scraping';
import { FacebookPlatformResponseValidator } from '../src/scrapers/social/facebook/validator.js';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}
const cookieHeader = Object.entries(cookieRecord).map(([k, v]) => `${k}=${v}`).join('; ');

async function main() {
  const resp = await gotScraping({
    url: 'https://www.facebook.com/',
    method: 'GET',
    proxyUrl: process.env.PROXY_URL,
    headers: { cookie: cookieHeader },
    timeout: { request: 60000 },
    throwHttpErrors: false,
  });

  const validator = new FacebookPlatformResponseValidator();
  const response = { status: resp.statusCode, headers: resp.headers, data: resp.body };
  console.log('status:', resp.statusCode);
  fs.writeFileSync('/tmp/fb-home.html', resp.body);
  console.log('body length:', resp.body.length);
  console.log('isRateLimit:', validator.isRateLimit(response));
  console.log('isBotChallenge:', validator.isBotChallenge(response));
  console.log('isValidPayload:', validator.isValidPayload(response));
}

main().catch(console.error);
