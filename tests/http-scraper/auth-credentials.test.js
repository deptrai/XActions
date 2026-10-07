// by nichxbt
/**
 * Tests for TwitterAuth — loginWithCredentials, refreshSession
 *
 * Uses vitest with mocked fetch. No real network requests.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import { TwitterAuth, AuthError } from '../../src/scrapers/twitter/http/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Response. */
function mockResponse(body, { status = 200, headers = {}, setCookies = [] } = {}) {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      ...headersObj,
      get: (name) => headersObj.get(name),
      getSetCookie: () => setCookies,
    },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const VALID_COOKIE_STRING = 'auth_token=abc123; ct0=csrf_tok; twid=u%3D999; guest_id=v1%3A1234';

const VERIFY_CREDENTIALS_RESPONSE = {
  id: 999,
  id_str: '999',
  name: 'Test User',
  screen_name: 'testuser',
};

// ---------------------------------------------------------------------------
// 7. Login Flow Step Sequencing (mocked responses)
// ---------------------------------------------------------------------------

describe('loginWithCredentials', () => {
  function makeFlowResponse(flowToken, subtasks = []) {
    return mockResponse({ flow_token: flowToken, subtasks });
  }

  it('completes the full login flow sequence', async () => {
    const callIndex = { i: 0 };
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      callIndex.i++;

      // Step 1: Flow init
      if (callIndex.i === 1) {
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      // Step 2: JS instrumentation
      if (callIndex.i === 2) {
        return makeFlowResponse('ft_js', [
          { subtask_id: 'LoginEnterUserIdentifierSSO' },
        ]);
      }
      // Step 3: Username
      if (callIndex.i === 3) {
        return makeFlowResponse('ft_user', [{ subtask_id: 'LoginEnterPassword' }]);
      }
      // Step 4: Password — success, no more subtasks
      if (callIndex.i === 4) {
        return makeFlowResponse('ft_pass', [], {
          status: 200,
          setCookies: [
            'auth_token=fresh_tok; Path=/; Domain=.x.com',
            'ct0=fresh_csrf; Path=/; Domain=.x.com',
          ],
        });
      }
      // Step 5: verify_credentials
      if (callIndex.i === 5) {
        return mockResponse(VERIFY_CREDENTIALS_RESPONSE);
      }
      return mockResponse({}, { status: 500 });
    });

    // We need to provide Set-Cookie headers. The flow response at step 4
    // must include them.
    // Re-implementing with proper header support:
    const fetchMock2 = vi.fn().mockImplementation(async (url, opts) => {
      callIndex.i++;
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        // Init
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      if (url.includes('onboarding/task.json') && body?.flow_token) {
        const subtask = body.subtask_inputs?.[0]?.subtask_id;

        if (subtask === 'LoginJsInstrumentationSubtask') {
          return makeFlowResponse('ft_js', [
            { subtask_id: 'LoginEnterUserIdentifierSSO' },
          ]);
        }
        if (subtask === 'LoginEnterUserIdentifierSSO') {
          return makeFlowResponse('ft_user', [
            { subtask_id: 'LoginEnterPassword' },
          ]);
        }
        if (subtask === 'LoginEnterPassword') {
          const res = makeFlowResponse('ft_done', []);
          res.headers.getSetCookie = () => [
            'auth_token=fresh_tok; Path=/; Domain=.x.com; Secure; HttpOnly',
            'ct0=fresh_csrf; Path=/; Domain=.x.com; Secure',
          ];
          return res;
        }
      }
      if (url.includes('verify_credentials')) {
        return mockResponse(VERIFY_CREDENTIALS_RESPONSE);
      }
      return mockResponse({}, { status: 500 });
    });

    callIndex.i = 0;
    const auth = new TwitterAuth({ fetch: fetchMock2 });
    const user = await auth.loginWithCredentials('testuser', 'password123', 'test@example.com');

    expect(user).toEqual({ id: '999', username: 'testuser', name: 'Test User' });
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('handles AccountDuplicationCheck subtask', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      if (url.includes('onboarding/task.json') && body?.flow_token) {
        const subtask = body.subtask_inputs?.[0]?.subtask_id;

        if (subtask === 'LoginJsInstrumentationSubtask') {
          return makeFlowResponse('ft_js', [
            { subtask_id: 'LoginEnterUserIdentifierSSO' },
          ]);
        }
        if (subtask === 'LoginEnterUserIdentifierSSO') {
          return makeFlowResponse('ft_user', [
            { subtask_id: 'LoginEnterPassword' },
          ]);
        }
        if (subtask === 'LoginEnterPassword') {
          return makeFlowResponse('ft_pass', [
            { subtask_id: 'AccountDuplicationCheck' },
          ]);
        }
        if (subtask === 'AccountDuplicationCheck') {
          expect(body.subtask_inputs[0].check_logged_in_account.link).toBe(
            'AccountDuplicationCheck_false',
          );
          const res = makeFlowResponse('ft_done', []);
          res.headers.getSetCookie = () => [
            'auth_token=dup_tok; Path=/',
            'ct0=dup_csrf; Path=/',
          ];
          return res;
        }
      }
      if (url.includes('verify_credentials')) {
        return mockResponse(VERIFY_CREDENTIALS_RESPONSE);
      }
      return mockResponse({}, { status: 500 });
    });

    const auth = new TwitterAuth({ fetch: fetchMock });
    const user = await auth.loginWithCredentials('user', 'pass', 'e@e.com');
    expect(user.username).toBe('testuser');
  });

  it('handles LoginAcid (email verification) subtask', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      if (url.includes('onboarding/task.json') && body?.flow_token) {
        const subtask = body.subtask_inputs?.[0]?.subtask_id;

        if (subtask === 'LoginJsInstrumentationSubtask') {
          return makeFlowResponse('ft_js', [
            { subtask_id: 'LoginEnterUserIdentifierSSO' },
          ]);
        }
        if (subtask === 'LoginEnterUserIdentifierSSO') {
          return makeFlowResponse('ft_user', [
            { subtask_id: 'LoginEnterPassword' },
          ]);
        }
        if (subtask === 'LoginEnterPassword') {
          return makeFlowResponse('ft_pass', [{ subtask_id: 'LoginAcid' }]);
        }
        if (subtask === 'LoginAcid') {
          expect(body.subtask_inputs[0].enter_text.text).toBe('verify@test.com');
          const res = makeFlowResponse('ft_done', []);
          res.headers.getSetCookie = () => [
            'auth_token=acid_tok; Path=/',
            'ct0=acid_csrf; Path=/',
          ];
          return res;
        }
      }
      if (url.includes('verify_credentials')) {
        return mockResponse(VERIFY_CREDENTIALS_RESPONSE);
      }
      return mockResponse({}, { status: 500 });
    });

    const auth = new TwitterAuth({ fetch: fetchMock });
    const user = await auth.loginWithCredentials('user', 'pass', 'verify@test.com');
    expect(user.username).toBe('testuser');
  });

  it('throws when LoginAcid requires email but none provided', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      if (url.includes('onboarding/task.json') && body?.flow_token) {
        const subtask = body.subtask_inputs?.[0]?.subtask_id;
        if (subtask === 'LoginJsInstrumentationSubtask') {
          return makeFlowResponse('ft_js', [
            { subtask_id: 'LoginEnterUserIdentifierSSO' },
          ]);
        }
        if (subtask === 'LoginEnterUserIdentifierSSO') {
          return makeFlowResponse('ft_user', [
            { subtask_id: 'LoginEnterPassword' },
          ]);
        }
        if (subtask === 'LoginEnterPassword') {
          return makeFlowResponse('ft_pass', [{ subtask_id: 'LoginAcid' }]);
        }
      }
      return mockResponse({}, { status: 500 });
    });

    const auth = new TwitterAuth({ fetch: fetchMock });
    await expect(auth.loginWithCredentials('user', 'pass')).rejects.toThrow(/email/i);
  });

  it('throws when 2FA is required', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      if (url.includes('onboarding/task.json') && body?.flow_token) {
        const subtask = body.subtask_inputs?.[0]?.subtask_id;
        if (subtask === 'LoginJsInstrumentationSubtask') {
          return makeFlowResponse('ft_js', [
            { subtask_id: 'LoginEnterUserIdentifierSSO' },
          ]);
        }
        if (subtask === 'LoginEnterUserIdentifierSSO') {
          return makeFlowResponse('ft_user', [
            { subtask_id: 'LoginEnterPassword' },
          ]);
        }
        if (subtask === 'LoginEnterPassword') {
          return makeFlowResponse('ft_pass', [
            { subtask_id: 'LoginTwoFactorAuthChallenge' },
          ]);
        }
      }
      return mockResponse({}, { status: 500 });
    });

    const auth = new TwitterAuth({ fetch: fetchMock });
    await expect(auth.loginWithCredentials('user', 'pass')).rejects.toThrow(
      /Two-factor authentication/,
    );
  });

  it('throws AuthError when a subtask step fails with non-200', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        return makeFlowResponse('ft_init', [
          { subtask_id: 'LoginJsInstrumentationSubtask' },
        ]);
      }
      // All subsequent subtask calls fail
      return mockResponse('Bad Request', { status: 400 });
    });

    const auth = new TwitterAuth({ fetch: fetchMock });
    await expect(auth.loginWithCredentials('user', 'pass')).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// 9. Session Refresh
// ---------------------------------------------------------------------------

describe('refreshSession', () => {
  it('re-logins with stored credentials', async () => {
    const callLog = [];
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      callLog.push(url);

      if (url.includes('onboarding/task.json') && !body?.flow_token) {
        return mockResponse({ flow_token: 'ft_init', subtasks: [{ subtask_id: 'LoginJsInstrumentationSubtask' }] });
      }
      if (url.includes('onboarding/task.json') && body?.flow_token) {
        const subtask = body.subtask_inputs?.[0]?.subtask_id;
        if (subtask === 'LoginJsInstrumentationSubtask') {
          return mockResponse({ flow_token: 'ft_js', subtasks: [{ subtask_id: 'LoginEnterUserIdentifierSSO' }] });
        }
        if (subtask === 'LoginEnterUserIdentifierSSO') {
          return mockResponse({ flow_token: 'ft_user', subtasks: [{ subtask_id: 'LoginEnterPassword' }] });
        }
        if (subtask === 'LoginEnterPassword') {
          const res = mockResponse({ flow_token: 'ft_done', subtasks: [] });
          res.headers.getSetCookie = () => [
            'auth_token=refreshed; Path=/',
            'ct0=refreshed_csrf; Path=/',
          ];
          return res;
        }
      }
      if (url.includes('verify_credentials')) {
        return mockResponse(VERIFY_CREDENTIALS_RESPONSE);
      }
      return mockResponse({}, { status: 500 });
    });

    const auth = new TwitterAuth({ fetch: fetchMock });

    // First login
    await auth.loginWithCredentials('myuser', 'mypass', 'my@email.com');

    // Now refresh
    const user = await auth.refreshSession();
    expect(user.username).toBe('testuser');
  });

  it('throws AuthError when no credentials stored (cookie-only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(VERIFY_CREDENTIALS_RESPONSE),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });
    await auth.loginWithCookies(VALID_COOKIE_STRING);

    await expect(auth.refreshSession()).rejects.toThrow(AuthError);
    await expect(auth.refreshSession()).rejects.toThrow(/re-import cookies/);
  });
});
