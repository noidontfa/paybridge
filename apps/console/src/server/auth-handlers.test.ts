import { describe, expect, it } from 'vitest';
import {
  handleChangePassword,
  handleForgotPassword,
  handleRefreshRedirect,
  handleResetPassword,
  handleSignIn,
  handleSignOut,
  safeNextPath,
} from './auth-handlers';

const options = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://api.internal:3000', fetch: fetchImpl });
const session = {
  accessToken: 'ACCESS-TOKEN',
  refreshToken: 'REFRESH-TOKEN',
  expiresIn: 300,
  user: { id: 'u1', email: 'u@x.test', name: 'Una', role: 'OPERATOR', organization: { id: 'o1', name: 'Acme' }, permissions: ['payments:view'] },
};
const post = (path: string, body?: unknown, cookie?: string) =>
  new Request(`http://console.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('sign-in', () => {
  it('stores both tokens in httpOnly cookies and returns only the User', async () => {
    const response = await handleSignIn(
      post('/api/auth/sign-in', { email: 'u@x.test', password: 'pw' }),
      options((async () => Response.json(session)) as typeof fetch),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ user: session.user });
    expect(text).not.toContain('TOKEN');
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('pb_access=ACCESS-TOKEN') && /HttpOnly/.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('pb_refresh=REFRESH-TOKEN') && /HttpOnly/.test(c))).toBe(true);
  });

  it("passes the API's refusal through without cookies", async () => {
    const response = await handleSignIn(
      post('/api/auth/sign-in', { email: 'u@x.test', password: 'bad' }),
      options((async () => Response.json({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, { status: 401 })) as typeof fetch),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a body without an email and password', async () => {
    const response = await handleSignIn(post('/api/auth/sign-in', { email: 'u@x.test' }), options(fetch));
    expect(response.status).toBe(400);
  });
});

describe('sign-out', () => {
  it('revokes the refresh token at the API and clears both cookies', async () => {
    const sent: unknown[] = [];
    const response = await handleSignOut(
      post('/api/auth/sign-out', undefined, 'pb_access=a; pb_refresh=r-1'),
      options((async (url: string | URL, init?: RequestInit) => {
        sent.push([url.toString(), init?.body]);
        return new Response(null, { status: 204 });
      }) as typeof fetch),
    );

    expect(sent).toEqual([['http://api.internal:3000/internal/auth/sign-out', '{"refreshToken":"r-1"}']]);
    const cleared = response.headers.getSetCookie().join('\n');
    expect(cleared).toMatch(/pb_access=; .*Max-Age=0/);
    expect(cleared).toMatch(/pb_refresh=; .*Max-Age=0/);
  });
});

describe('refresh redirect', () => {
  const get = (cookie: string, next = '/payments?x=1') =>
    new Request(`http://console.test/api/auth/refresh?next=${encodeURIComponent(next)}`, { headers: { cookie } });

  it('refreshes, sets the cookies and goes back to the page', async () => {
    const response = await handleRefreshRedirect(get('pb_refresh=r-redirect-ok'), options((async () => Response.json(session)) as typeof fetch));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://console.test/payments?x=1');
    expect(response.headers.getSetCookie().join('\n')).toContain('pb_access=ACCESS-TOKEN');
  });

  it('goes to sign-in and clears the cookies when the refresh fails', async () => {
    const response = await handleRefreshRedirect(
      get('pb_refresh=r-redirect-bad'),
      options((async () => Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 })) as typeof fetch),
    );
    expect(response.headers.get('location')).toBe('http://console.test/sign-in');
    expect(response.headers.getSetCookie().join('\n')).toMatch(/pb_refresh=; .*Max-Age=0/);
  });

  it.each(['//evil.test', 'https://evil.test', '/\\evil.test', '', 'payments'])('only sends the browser to a path on this site: %j', (next) => {
    expect(safeNextPath(next)).toBe('/');
  });
});

describe('password reset and change', () => {
  const calls = () => {
    const sent: Array<[string, unknown, unknown]> = [];
    const impl = (async (url: string | URL, init?: RequestInit) => {
      sent.push([url.toString(), init?.body, (init?.headers as Record<string, string> | undefined)?.authorization]);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    return { sent, impl };
  };

  it('forwards a reset request and answers as the API does', async () => {
    const { sent, impl } = calls();
    const response = await handleForgotPassword(post('/api/auth/forgot-password', { email: 'u@x.test' }), options(impl));
    expect(response.status).toBe(204);
    expect(sent).toEqual([['http://api.internal:3000/internal/auth/password-reset/request', '{"email":"u@x.test"}', undefined]]);
  });

  it("passes the API's refusal of a reset link through", async () => {
    const response = await handleResetPassword(
      post('/api/auth/reset-password', { token: 't', password: 'a-long-enough-password' }),
      options((async () => Response.json({ statusCode: 400, code: 'INVALID_RESET_TOKEN' }, { status: 400 })) as typeof fetch),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('adds the access token and the refresh token from the cookies to a password change', async () => {
    const { sent, impl } = calls();
    const response = await handleChangePassword(
      post('/api/auth/change-password', { currentPassword: 'old', newPassword: 'a-long-enough-password' }, 'pb_access=a-1; pb_refresh=r-1'),
      options(impl),
    );
    expect(response.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe('http://api.internal:3000/internal/auth/change-password');
    expect(JSON.parse(sent[0]![1] as string)).toEqual({ currentPassword: 'old', newPassword: 'a-long-enough-password', refreshToken: 'r-1' });
    expect(sent[0]![2]).toBe('Bearer a-1');
  });

  it('ends the session when there is no way to sign the call', async () => {
    const response = await handleChangePassword(post('/api/auth/change-password', { currentPassword: 'a', newPassword: 'b' }), options(fetch));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
