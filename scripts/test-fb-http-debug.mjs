import 'dotenv/config';
import fs from 'node:fs';
import { gotScraping } from 'got-scraping';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}

const proxyConfig = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/proxy-config.json', 'utf8'));
const cookieHeader = Object.entries(cookieRecord)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ');

async function main() {
  console.log('cookie c_user:', cookieRecord.c_user);
  console.log('cookie xs starts:', cookieRecord.xs?.slice(0, 30));

  const proxyUrl = process.env.PROXY_URL || proxyConfig.gatewayUrl;
  console.log('proxy:', proxyUrl.replace(/:.*@/, ':****@'));

  const resp = await gotScraping({
    url: 'https://www.facebook.com/',
    method: 'GET',
    proxyUrl,
    headers: {
      cookie: cookieHeader,
    },
    timeout: { request: 60000 },
    throwHttpErrors: false,
  });

  const body = resp.body;
  console.log('status:', resp.statusCode);
  console.log('title:', body.match(/<title>([^<]*)<\/title>/)?.[1]);
  console.log('has password:', body.includes('type="password"'));
  console.log('has lsd:', body.includes('name="lsd"'));
  console.log('has dtsg:', body.includes('DTSGInitialData'));
  console.log('has login:', /log in to facebook|log into facebook/i.test(body));
  console.log('body first 500:', body.slice(0, 500));
}

main().catch(console.error);
