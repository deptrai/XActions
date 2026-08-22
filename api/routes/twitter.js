// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();
// Twitter OAuth 2.0 configuration
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';

// Derive base URL — works on Vercel (VERCEL_URL), Railway (API_URL), or localhost
function getBaseUrl() {
  if (process.env.API_URL) return process.env.API_URL.trim().replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.trim()}`;
  return 'http://localhost:3001';
}

function getFrontendUrl() {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.trim().replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.trim()}`;
  return 'http://localhost:3000';
}

// Stateless OAuth state — encode data as a signed JWT used as the `state` param.
// Works across serverless instances (no shared memory needed).
/**
 * @param {Record<string, unknown>} data
 */
function createOAuthState(data) {
  return jwt.sign(data, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '10m' });
}

/**
 * @param {string} state
 * @returns {Record<string, unknown> | null}
 */
function parseOAuthState(state) {
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET || 'dev-secret');
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }
    return /** @type {Record<string, unknown>} */ (payload);
  } catch {
    return null;
  }
}

// Build Twitter OAuth URL
/**
 * @param {string} state
 * @param {string} codeChallenge
 */
function buildOAuthUrl(state, codeChallenge) {
  const callbackUrl = `${getBaseUrl()}/api/twitter/callback`;
  const authUrl = new URL('https://x.com/i/oauth2/authorize');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', TWITTER_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', callbackUrl);
  authUrl.searchParams.append('scope', 'tweet.read users.read follows.read follows.write offline.access');
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('code_challenge', codeChallenge);
  authUrl.searchParams.append('code_challenge_method', 'S256');
  return authUrl.toString();
}

// Exchange OAuth code for Twitter tokens and user info
/**
 * @param {string} code
 * @param {string} codeVerifier
 * @returns {Promise<{ twitterUser: Record<string, unknown>; tokens: { access_token: string; refresh_token: string; expires_in: number } }>}
 */
async function exchangeCodeForUser(code, codeVerifier) {
  const callbackUrl = `${getBaseUrl()}/api/twitter/callback`;
  const tokenResponse = await axios.post(
    'https://api.x.com/2/oauth2/token',
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: callbackUrl,
      code_verifier: codeVerifier
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: { username: TWITTER_CLIENT_ID, password: TWITTER_CLIENT_SECRET }
    }
  );

  const tokenData = /** @type {Record<string, unknown>} */ (tokenResponse.data);
  const access_token = tokenData.access_token ? String(tokenData.access_token) : '';
  const refresh_token = tokenData.refresh_token ? String(tokenData.refresh_token) : '';
  const expires_in = Number(tokenData.expires_in) || 0;

  const userResponse = await axios.get('https://api.x.com/2/users/me', {
    headers: { Authorization: `Bearer ${access_token}` }
  });

  const userData = /** @type {Record<string, unknown>} */ (userResponse.data);
  const twitterUser = /** @type {Record<string, unknown>} */ (userData.data || {});

  return {
    twitterUser,
    tokens: { access_token, refresh_token, expires_in }
  };
}

// Sign in with X — no auth required, redirects to Twitter OAuth
router.get('/login', (req, res) => {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = createOAuthState({ codeVerifier, flow: 'login' });

  res.redirect(buildOAuthUrl(state, codeChallenge));
});

// Connect X to existing account — requires auth
router.get('/connect', authMiddleware, (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = createOAuthState({ codeVerifier, flow: 'connect', userId: reqUser.id });

  res.json({ authUrl: buildOAuthUrl(state, codeChallenge), state });
});

// OAuth callback — handles both login and connect flows
router.get('/callback', async (req, res) => {
  const FRONTEND_URL = getFrontendUrl();
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/login?error=missing_params`);
    }

    // Verify JWT-encoded state — cryptographically signed, no shared storage needed
    const oauthData = parseOAuthState(state);
    if (!oauthData) {
      return res.redirect(`${FRONTEND_URL}/login?error=invalid_state`);
    }

    const codeVerifier = String(oauthData.codeVerifier);
    const { twitterUser, tokens } = await exchangeCodeForUser(code, codeVerifier);
    const { access_token, refresh_token, expires_in } = tokens;

    const twitterData = {
      twitterId: twitterUser.id ? String(twitterUser.id) : null,
      twitterUsername: twitterUser.username ? String(twitterUser.username) : null,
      twitterAccessToken: access_token,
      twitterRefreshToken: refresh_token,
      twitterTokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
      authMethod: 'oauth'
    };

    // --- Login/Signup flow ---
    if (String(oauthData.flow) === 'login') {
      let user = await prisma.user.findUnique({ where: { twitterId: twitterData.twitterId || undefined } });

      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: twitterData
        });
      } else {
        let username = twitterData.twitterUsername || '';
        const existingUsername = await prisma.user.findUnique({ where: { username } });
        if (existingUsername) {
          username = `${username}_${crypto.randomBytes(3).toString('hex')}`;
        }

        user = await prisma.user.create({
          data: {
            username,
            credits: 0,
            ...twitterData,
            subscription: {
              create: {
                tier: 'free',
                status: 'active',
                startDate: new Date()
              }
            }
          }
        });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '7d' }
      );

      res.redirect(`${FRONTEND_URL}/login?oauth=success#token=${token}`);
      return;
    }

    // --- Connect flow (existing authenticated user) ---
    if (String(oauthData.flow) === 'connect' && oauthData.userId) {
      await prisma.user.update({
        where: { id: String(oauthData.userId) },
        data: twitterData
      });

      res.redirect(`${FRONTEND_URL}/dashboard?twitter_connected=true`);
      return;
    }

    res.redirect(`${FRONTEND_URL}/login?error=invalid_flow`);
  } catch (error) {
    console.error('❌ Twitter OAuth callback error:', axios.isAxiosError(error) ? error.response?.data : (error instanceof Error ? error.message : String(error)));
    res.redirect(`${getFrontendUrl()}/login?error=twitter_connection_failed`);
  }
});

// Disconnect Twitter
router.post('/disconnect', authMiddleware, async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    await prisma.user.update({
      where: { id: reqUser.id },
      data: {
        twitterId: null,
        twitterUsername: null,
        twitterAccessToken: null,
        twitterRefreshToken: null,
        twitterTokenExpiry: null
      }
    });

    res.json({ message: 'Twitter account disconnected' });
  } catch (error) {
    console.error('❌ Twitter disconnect error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: 'Failed to disconnect Twitter account' });
  }
});

// Refresh Twitter token
/**
 * @param {User} user
 */
async function refreshTwitterToken(user) {
  try {
    const refreshToken = user.twitterRefreshToken || '';
    const response = await axios.post(
      'https://api.x.com/2/oauth2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: TWITTER_CLIENT_ID
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        auth: {
          username: TWITTER_CLIENT_ID,
          password: TWITTER_CLIENT_SECRET
        }
      }
    );

    const tokenData = /** @type {Record<string, unknown>} */ (response.data);
    const access_token = tokenData.access_token ? String(tokenData.access_token) : '';
    const refresh_token = tokenData.refresh_token ? String(tokenData.refresh_token) : '';
    const expires_in = Number(tokenData.expires_in) || 0;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twitterAccessToken: access_token,
        twitterRefreshToken: refresh_token,
        twitterTokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null
      }
    });

    return access_token;
  } catch (error) {
    console.error('❌ Token refresh error:', (error instanceof Error ? error.message : String(error)));
    throw new Error('Failed to refresh Twitter token');
  }
}

// Get Twitter API client with auto-refresh
/**
 * @param {User} user
 */
async function getTwitterClient(user) {
  let accessToken = user.twitterAccessToken || '';

  // Check if token needs refresh
  if (user.twitterTokenExpiry && new Date() >= user.twitterTokenExpiry) {
    accessToken = await refreshTwitterToken(user);
  }

  return axios.create({
    baseURL: 'https://api.x.com/2',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}

export default router;
export { getTwitterClient };
