// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Remote Facebook API client for MCP server.
 *
 * When XACTIONS_MODE=remote, Facebook MCP tools route through the production
 * REST API instead of using Prisma/Puppeteer locally. This requires
 * XACTIONS_API_TOKEN (JWT) for authentication.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 */

const SCRAPE_ACTION_MAP = {
  x_facebook_search: 'search',
  x_facebook_post_comments: 'post_comments',
  x_facebook_group_posts: 'group_posts',
  x_facebook_group_comments: 'group_comments',
  x_facebook_posts: 'posts',
};

/**
 * Call the production Facebook API.
 * @param {string} apiUrl - Base API URL (e.g. https://api-xactions.medirus.online)
 * @param {string} token - JWT token
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. /api/facebook/scrape)
 * @param {object|null} body - Request body for POST
 * @returns {Promise<object>} Parsed JSON response
 */
async function callFacebookApi(apiUrl, token, method, path, body = null) {
  const url = `${apiUrl}${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `API returned HTTP ${res.status}`);
    err.status = res.status;
    err.apiError = data;
    throw err;
  }
  return data;
}

/**
 * List Facebook accounts via remote API.
 * Maps to: GET /api/facebook/accounts
 */
export async function remoteListAccounts(apiUrl, token) {
  const data = await callFacebookApi(apiUrl, token, 'GET', '/api/facebook/accounts');
  return { accounts: data.accounts || [] };
}

/**
 * Execute a Facebook scrape tool via remote API.
 * Maps to: POST /api/facebook/scrape
 */
export async function remoteScrapeTool(apiUrl, token, toolName, args) {
  const { authCookie, dryRun, ...rest } = args;
  const action = SCRAPE_ACTION_MAP[toolName];
  if (!action) {
    throw new Error(`❌ remoteScrapeTool: unknown tool "${toolName}"`);
  }

  const resolvedDryRun = dryRun === false ? false : true;

  if (resolvedDryRun) {
    return { dryRun: true, platform: 'facebook', preview: { action, ...rest } };
  }

  // Pass authCookie through — API resolves stored accountId or uses raw c_user/xs.
  const body = { action, ...rest };
  if (authCookie) {
    body.authCookie = authCookie;
  }

  const data = await callFacebookApi(apiUrl, token, 'POST', '/api/facebook/scrape', body);
  return data.result || data;
}

/**
 * Execute Facebook automation via remote API.
 * Maps to: POST /api/facebook/automate
 */
export async function remoteAutomateTool(apiUrl, token, args) {
  const { action, urls, text, dryRun, authCookie, ...rest } = args;

  const resolvedDryRun = dryRun === false ? false : true;

  if (resolvedDryRun) {
    return {
      ok: true,
      action,
      dryRun: true,
      preview: { targets: urls || [], action: 'pending' },
      results: [],
    };
  }

  const body = { action, urls, text, ...rest };
  if (authCookie) {
    body.authCookie = authCookie;
  }

  const data = await callFacebookApi(apiUrl, token, 'POST', '/api/facebook/automate', body);
  return data;
}

/**
 * Check if a tool is supported in remote mode.
 * Epic 4 tools (schedule_post, share_posts, warmup, etc.) require local browser
 * automation and are NOT available in remote mode.
 */
export function isRemoteSupported(toolName) {
  const SUPPORTED = new Set([
    'x_facebook_list_accounts',
    'x_facebook_search',
    'x_facebook_post_comments',
    'x_facebook_group_posts',
    'x_facebook_group_comments',
    'x_facebook_posts',
    'x_facebook_automate',
  ]);
  return SUPPORTED.has(toolName);
}
