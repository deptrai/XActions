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
  for (const http2 of [true, false]) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = await gotScraping({
          url: 'https://www.facebook.com/',
          method: 'GET',
          proxyUrl: process.env.PROXY_URL,
          headers: { cookie: cookieHeader },
          timeout: { request: 30000 },
          throwHttpErrors: false,
          http2,
        });
        console.log(`http2=${http2} run ${i+1}: status ${resp.statusCode}, title ${resp.body.match(/<title>([^<]*)<\/title>/)?.[1]}, dtsg ${resp.body.includes('DTSGInitialData')}`);
      } catch (err) {
        console.log(`http2=${http2} run ${i+1}: ERROR ${err.code || err.message}`);
      }
    }
  }
}

main().catch(console.error);
