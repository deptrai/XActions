// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// LEGACY — see docs/deprecation-plan.md (Replaced by FacebookClient.requestGraphQl / facebook:messenger_share in Story 13.9)
/**
 * Send message to UID via GraphQL - Server-side HTTP request (C# Main.cs:579)
 * Uses full session state params required by Facebook.
 *
 * @deprecated Use FacebookCrawler with action 'messenger_share' or FacebookClient (Story 13.9) instead.
 */

import axios from 'axios';

/**
 * Fetch session state values from Facebook home page.
 * These values are required for GraphQL API calls.
 * @param {string} cookieStr - Full cookie string
 * @returns {Promise<FacebookSessionState>} Session state values
 */
async function fetchSessionState(cookieStr) {
  const res = await axios.get('https://www.facebook.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Cookie: cookieStr,
    },
    responseType: 'text',
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const html = res.data;
  /** @type {FacebookSessionState} */
  const state = {};

  // Extract session state values from HTML
  const patterns = {
    hs: /"hs":"([^"]+)"/,
    hsi: /"hsi":"([^"]+)"/,
    dyn: /"__dyn":\[([^\]]+)\]/,
    csr: /"__csr":"([^"]+)"/,
    hsdp: /"__hsdp":\{([^}]+)\}/,
    hblp: /"__hblp":\{([^}]+)\}/,
    spin_r: /"__spin_r":(\d+)/,
    spin_t: /"__spin_t":(\d+)/,
    fb_dtsg: /\{"token":"(NAf[^"]+)"/,
    lsd: /\["LSD",\[\],\{"token":"([^"]+)"/,
    jazoest: /&jazoest=(\d+)/,
    revision: /"__rev":(\d+)/,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = html.match(pattern);
    state[key] = match ? match[1] : undefined;
  }

  return state;
}

/**
 * Send message to a UID via Facebook GraphQL API.
 * Replicates C# Main.cs:Post() lines 579-580.
 *
 * @param {string} targetUid - UID to send message to
 * @param {string} cookieStr - Full cookie string
 * @param {FacebookSessionTokens & FacebookSessionState} [tokens]
 * @returns {Promise<{ ok: boolean, response?: string, error?: string }>}
 */
export async function sendMessageToUidServerSide(targetUid, cookieStr, tokens = {}) {
  try {
    // Fetch session state if not provided
    const state = tokens.hs ? /** @type {FacebookSessionState} */ (tokens) : await fetchSessionState(cookieStr);

    // Build the GraphQL mutation variables
    const variables = JSON.stringify({
      input: {
        ad_id: null,
        ad_impression_client_token: null,
        page_id: String(targetUid),
        post_id: null,
        actor_id: String(targetUid),
        client_mutation_id: '1',
      },
    });

    // Build form data matching C# Main.cs:579
    const formData = new URLSearchParams({
      av: String(targetUid),
      __aaid: '0',
      __user: String(targetUid),
      __a: '1',
      __req: '1a',
      __hs: state.hs || '20553.HCSV2:comet_pkg.2.1...0',
      __hsi: state.hsi || '',
      __dyn: state.dyn || '',
      __csr: state.csr || '',
      __hsdp: state.hsdp || '',
      __hblp: state.hblp || '',
      dpr: '3',
      __ccg: 'EXCELLENT',
      __rev: state.revision || tokens.spin_r || '1044824727',
      __s: 'grviip:iqbv5e:4jh65u',
      __spin_r: state.spin_r || tokens.spin_r || '1044824727',
      __spin_b: 'trunk',
      __spin_t: state.spin_t || tokens.spin_t || '1786335835',
      __comet_req: '15',
      fb_dtsg: tokens.fb_dtsg || state.fb_dtsg || '',
      jazoest: tokens.jazoest || state.jazoest || '25302',
      lsd: tokens.lsd || state.lsd || '',
      doc_id: '29460155383630960',
      variables,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'MWChatBusinessCTAAdsSenderMutation',
      server_timestamps: 'true',
      x_fb_lsd: tokens.lsd || state.lsd || '',
    }).toString();

    // Make server-side HTTP request (like C# xNet)
    const res = await axios.post('https://www.facebook.com/api/graphql/', formData, {
      headers: {
        'authority': 'www.facebook.com',
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://www.facebook.com',
        'referer': `https://www.facebook.com/profile.php?id=${targetUid}`,
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'x-asbd-id': '359341',
        'x-fb-friendly-name': 'MWChatBusinessCTAAdsSenderMutation',
        'x-fb-lsd': tokens.lsd || state.lsd || '',
        Cookie: cookieStr,
      },
      responseType: 'text',
      validateStatus: () => true,
    });

    const text = typeof res.data === 'string' ? res.data : String(res.data);

    // Check for success indicator (C# Main.cs:581)
    if (text.includes('messenger_business_ads_sender')) {
      return { ok: true, response: text.substring(0, 200) };
    }

    // Check for error
    if (text.includes('error') || text.includes('Error')) {
      return { ok: false, error: text.substring(0, 300) };
    }

    return { ok: true, response: text.substring(0, 200) };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

export default { sendMessageToUidServerSide, fetchSessionState };
