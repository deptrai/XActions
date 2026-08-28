import 'dotenv/config';
import fs from 'node:fs';
import { gotScraping } from 'got-scraping';
import { FacebookClient } from '../src/scrapers/social/facebook/client.js';
import { ProxyIpPool } from '../src/proxy/proxy-pool.js';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}

const proxyPool = new ProxyIpPool({ proxies: [process.env.PROXY_URL], validateOnAdd: false });

const realTransport = async (reqOpts) => {
  console.log('TRANSPORT reqOpts:', {
    method: reqOpts.method,
    url: reqOpts.url,
    headers: reqOpts.headers,
    timeout: reqOpts.timeout,
    proxy: reqOpts.proxy,
  });

  const { method, url, headers, body, json, proxy, timeout } = reqOpts;
  const options = {
    method,
    url,
    headers,
    timeout: { request: timeout === undefined ? 30000 : timeout },
    throwHttpErrors: false,
  };
  if (json !== undefined) {
    options.json = json;
  } else if (body !== undefined) {
    options.body = body;
  }
  if (proxy) {
    const { getProxyAgent } = await import('../src/proxy/providers.js');
    const proxyUrl = getProxyAgent(proxy, { client: 'got' });
    console.log('TRANSPORT proxyUrl:', proxyUrl.replace(/:.*@/, ':****@'));
    options.proxyUrl = proxyUrl;
  }

  const resp = await gotScraping(options);
  console.log('TRANSPORT status:', resp.statusCode);
  let data = resp.body;
  try {
    data = JSON.parse(resp.body);
  } catch {}
  return { status: resp.statusCode, headers: resp.headers, data };
};

async function main() {
  const client = new FacebookClient({ proxyPool, client: 'got', httpClient: realTransport });
  const tokens = await client.ensureTokens(cookieRecord.c_user, cookieRecord);
  console.log('tokens:', tokens);
}

main().catch((err) => {
  console.error('ERROR:', err);
});
