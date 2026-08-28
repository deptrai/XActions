import 'dotenv/config';
import fs from 'node:fs';
import got from 'got';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}

const proxyConfig = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/proxy-config.json', 'utf8'));
const cookieHeader = Object.entries(cookieRecord)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  try {
    const resp = await got('https://www.facebook.com/', {
      method: 'GET',
      proxy: { url: proxyConfig.gatewayUrl },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cookie': cookieHeader,
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      timeout: { request: 60000 },
      throwHttpErrors: false,
      decompress: true,
    });

    const body = resp.body;
    console.log('status:', resp.statusCode);
    console.log('title:', body.match(/<title>([^<]*)<\/title>/)?.[1]);
    console.log('has lsd:', body.includes('name="lsd"'));
    console.log('has dtsg:', body.includes('DTSGInitialData'));
    console.log('body first 500:', body.slice(0, 500));
  } catch (err) {
    console.error('request error:', err.message);
  }
}

main();
