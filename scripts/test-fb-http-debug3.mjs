import 'dotenv/config';
import fs from 'node:fs';
import { gotScraping } from 'got-scraping';
import { ProxyIpPool } from '../src/proxy/proxy-pool.js';
import { getProxyAgent } from '../src/proxy/providers.js';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}

const cookieHeader = Object.entries(cookieRecord)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ');

async function main() {
  const proxyPool = new ProxyIpPool({ proxies: [process.env.PROXY_URL], validateOnAdd: false });
  const proxy = proxyPool.getStickyProxy(cookieRecord.c_user);
  console.log('proxy object:', { ...proxy, password: '***' });

  const proxyUrl = getProxyAgent(proxy, { client: 'got' });
  console.log('proxyUrl:', proxyUrl.replace(/:.*@/, ':****@'));

  const resp = await gotScraping({
    url: 'https://www.facebook.com/',
    method: 'GET',
    proxyUrl,
    headers: { cookie: cookieHeader },
    timeout: { request: 30000 },
    throwHttpErrors: false,
  });

  const body = resp.body;
  console.log('status:', resp.statusCode);
  console.log('title:', body.match(/<title>([^<]*)<\/title>/)?.[1]);
  console.log('has dtsg:', body.includes('DTSGInitialData'));
  console.log('body first 200:', body.slice(0, 200));
}

main().catch(console.error);
