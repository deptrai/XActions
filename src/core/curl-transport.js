// Curl-based HTTP transport for anti-bot scraping (OpenSSL TLS fingerprint)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

const execFileAsync = promisify(execFile);

/**
 * Creates a curl-based HTTP client function.
 * @param {string} [platform='default']
 * @returns {Function}
 */
export function createCurlTransport(platform = 'default') {
  return async (reqOpts) => {
    const { method, url, headers, body, json, proxy, timeout, raw } = reqOpts;
    if (!/^https?:\/\//i.test(url)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Absolute URL is required for curl transport',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const args = ['-sS', '--max-time', String(Math.ceil((timeout ?? 30000) / 1000))];

    if (proxy) {
      const { getProxyAgent } = await import('../proxy/index.js');
      const proxyUrl = getProxyAgent(proxy, { client: 'curl' });
      if (typeof proxyUrl === 'string') args.push('--proxy', proxyUrl);
    }

    if (method && method !== 'GET') args.push('-X', method);

    if (json !== undefined) {
      args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(json));
    } else if (body !== undefined) {
      args.push('-d', typeof body === 'string' ? body : JSON.stringify(body));
    }

    const hdrs = headers || {};
    for (const [k, v] of Object.entries(hdrs)) {
      args.push('-H', `${k}: ${v}`);
    }

    // Capture headers via dump-header and status via write-out
    args.push('-D', '/dev/stderr', '-w', '\n__HTTP_STATUS__:%{http_code}');
    args.push(url);

    try {
      const { stdout, stderr } = await execFileAsync('curl', args, { maxBuffer: 50 * 1024 * 1024 });

      const respHeaders = {};
      for (const line of String(stderr).split('\n')) {
        const m = line.match(/^([^:]+):\s*(.+)$/);
        if (m) respHeaders[m[1].toLowerCase().trim()] = m[2].trim();
      }

      const statusMatch = String(stdout).match(/__HTTP_STATUS__:(\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
      const bodyText = String(stdout).replace(/\n__HTTP_STATUS__:\d+\s*$/, '');

      if (raw) {
        return { status, headers: respHeaders, data: undefined, body: bodyText };
      }

      let data = bodyText;
      try { data = JSON.parse(bodyText); } catch {}
      return { status, headers: respHeaders, data };
    } catch (err) {
      const code = err?.code || '';
      if (code === 'ECONNRESET' || String(err?.message || '').includes('ECONNRESET')) {
        throw new PlatformError({
          type: ErrorTypes.PROXY_DEAD,
          code: 'XACT_5020',
          message: 'Proxy connection failed (curl)',
          statusCode: 503,
          suggestedAction: SuggestedActions.RETRY,
          platform,
        });
      }
      throw err;
    }
  };
}
