import { describe, expect, it } from 'vitest';
import { forwardToApi } from './bff-proxy';

function recordingFetch(respond: () => Response = () => Response.json({ ok: true })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('forwardToApi', () => {
  it('sends the same path, method, query and body to the API base URL', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const request = new Request('http://console.test/api/bff/internal/payments/p%201/other-write?a=1&b=x%20y', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'secret=1; pb_access=a' },
      body: JSON.stringify({ note: 'n' }),
    });

    const response = await forwardToApi(request, ['internal', 'payments', 'p 1', 'other-write'], {
      baseUrl: 'http://api.internal:3000/',
      fetch: fetchImpl,
      authenticate: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.internal:3000/internal/payments/p%201/other-write?a=1&b=x%20y');
    expect(calls[0]?.init.method).toBe('POST');
    expect(new TextDecoder().decode(calls[0]?.init.body as ArrayBuffer)).toBe('{"note":"n"}');
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(calls[0]?.init.headers).get('cookie')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });

  it('sends no body for GET and passes the API status through', async () => {
    const { calls, fetchImpl } = recordingFetch(() => Response.json({ message: 'gone' }, { status: 404 }));
    const response = await forwardToApi(new Request('http://console.test/api/bff/internal/payments/x'), ['internal', 'payments', 'x'], {
      baseUrl: 'http://api.internal:3000',
      fetch: fetchImpl,
      authenticate: false,
    });
    expect(calls[0]?.init.body).toBeUndefined();
    expect(response.status).toBe(404);
  });

  it('answers 502 in the API error shape when the API is unreachable', async () => {
    const response = await forwardToApi(new Request('http://console.test/api/bff/internal/payments/x'), ['internal', 'payments', 'x'], {
      baseUrl: 'http://api.internal:3000',
      authenticate: false,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ statusCode: 502, code: 'API_UNREACHABLE' });
  });

  describe('the signed-in User', () => {
    const cookie = (access?: string, refresh?: string) =>
      [access && `pb_access=${access}`, refresh && `pb_refresh=${refresh}`].filter(Boolean).join('; ');
    const sessionFrom = (n: number) => ({
      accessToken: `access-${n}`,
      refreshToken: `refresh-${n}`,
      expiresIn: 300,
      user: { id: 'u1', email: 'u@x.test', name: 'U', role: 'OPERATOR', organization: null, permissions: [] },
    });
    const bearerOf = (call: { init: RequestInit }) => new Headers(call.init.headers).get('authorization');
    const setCookies = (response: Response) => response.headers.getSetCookie();

    const call = async (fetchImpl: typeof fetch, cookies: string, body?: string, method = 'POST') =>
      forwardToApi(
        new Request('http://console.test/api/bff/internal/payments/p1/review-resolution', {
          method,
          headers: { cookie: cookies, 'content-type': 'application/json' },
          body,
        }),
        ['internal', 'payments', 'p1', 'review-resolution'],
        { baseUrl: 'http://api.internal:3000', fetch: fetchImpl },
      );

    it('forwards the access token as a bearer token, and does not forward the cookie', async () => {
      const { calls, fetchImpl } = recordingFetch();
      await call(fetchImpl, cookie('access-A', 'refresh-A'), '{"note":"n"}');
      expect(bearerOf(calls[0]!)).toBe('Bearer access-A');
      expect(new Headers(calls[0]!.init.headers).get('cookie')).toBeNull();
    });

    it('sends the body unchanged: the API takes the actor from the token, whatever the browser says', async () => {
      const { calls, fetchImpl } = recordingFetch();
      await call(fetchImpl, cookie('access-A', 'refresh-A'), '{"note":"n","actor":"someone-else"}');
      expect(new TextDecoder().decode(calls[0]!.init.body as ArrayBuffer)).toBe('{"note":"n","actor":"someone-else"}');
    });

    it('leaves reads without a body', async () => {
      const { calls, fetchImpl } = recordingFetch();
      await call(fetchImpl, cookie('access-A', 'refresh-A'), undefined, 'GET');
      expect(calls[0]!.init.body).toBeUndefined();
    });

    it('refreshes when the access cookie has expired, forwards the new token and sets new httpOnly cookies', async () => {
      const calls: string[] = [];
      let upstreamBearer: string | null = null;
      const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
        calls.push(url.toString());
        if (url.toString().endsWith('/internal/auth/refresh')) return Response.json(sessionFrom(1));
        upstreamBearer = new Headers(init?.headers).get('authorization');
        return Response.json({ ok: true });
      }) as typeof fetch;

      const response = await call(fetchImpl, cookie(undefined, 'refresh-expired-access'), '{}');

      expect(calls.map((u) => new URL(u).pathname)).toEqual(['/internal/auth/refresh', '/internal/payments/p1/review-resolution']);
      expect(upstreamBearer).toBe('Bearer access-1');
      const cookies = setCookies(response);
      expect(cookies).toHaveLength(2);
      for (const c of cookies) expect(c).toMatch(/HttpOnly/);
      expect(cookies.join('\n')).toContain('pb_access=access-1');
      expect(cookies.join('\n')).toContain('pb_refresh=refresh-1');
      expect(await response.text()).not.toContain('access-1');
    });

    it('refreshes and retries once when the API refuses the access token', async () => {
      const bearers: (string | null)[] = [];
      const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
        if (url.toString().endsWith('/internal/auth/refresh')) return Response.json(sessionFrom(2));
        bearers.push(new Headers(init?.headers).get('authorization'));
        return bearers.length === 1 ? Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 }) : Response.json({ ok: true });
      }) as typeof fetch;

      const response = await call(fetchImpl, cookie('access-old', 'refresh-retry'), '{}');

      expect(bearers).toEqual(['Bearer access-old', 'Bearer access-2']);
      expect(response.status).toBe(200);
      expect(setCookies(response).join('\n')).toContain('pb_refresh=refresh-2');
    });

    it('shares one refresh between simultaneous requests, so the refresh token is used once', async () => {
      let refreshCalls = 0;
      const fetchImpl = (async (url: string | URL) => {
        if (url.toString().endsWith('/internal/auth/refresh')) {
          refreshCalls++;
          return Response.json(sessionFrom(3));
        }
        return Response.json({ ok: true });
      }) as typeof fetch;

      await Promise.all([1, 2, 3].map(() => call(fetchImpl, cookie(undefined, 'refresh-shared'), '{}')));

      expect(refreshCalls).toBe(1);
    });

    it('answers 401 SESSION_EXPIRED and clears the cookies when the refresh fails', async () => {
      const { calls, fetchImpl } = recordingFetch(() => Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 }));

      const response = await call(fetchImpl, cookie(undefined, 'refresh-dead'), '{}');

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'SESSION_EXPIRED' });
      const cleared = setCookies(response).join('\n');
      expect(cleared).toMatch(/pb_access=; .*Max-Age=0/);
      expect(cleared).toMatch(/pb_refresh=; .*Max-Age=0/);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/internal/auth/refresh']);
    });

    it('answers 401 SESSION_EXPIRED without calling the API when there is no session at all', async () => {
      const { calls, fetchImpl } = recordingFetch();
      const response = await call(fetchImpl, '', '{}');
      expect(response.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it('sends no token in mock mode, where there is no sign-in', async () => {
      const { calls, fetchImpl } = recordingFetch();
      await forwardToApi(new Request('http://console.test/api/bff/internal/x'), ['internal', 'x'], {
        baseUrl: 'http://api.internal:3000',
        fetch: fetchImpl,
        authenticate: false,
      });
      expect(bearerOf(calls[0]!)).toBeNull();
    });
  });

  describe('what may be forwarded', () => {
    const attempt = async (path: string[], method = 'GET') => {
      const { calls, fetchImpl } = recordingFetch();
      const response = await forwardToApi(new Request('http://console.test/api/bff/x', { method, body: method === 'GET' ? undefined : '{}' }), path, {
        baseUrl: 'http://api.internal:3000',
        fetch: fetchImpl,
        authenticate: false,
      });
      return { calls, response };
    };

    it.each([
      [['payments', 'x']],
      [['health']],
      [[]],
    ])('rejects a path outside /internal: %j', async (path) => {
      const { calls, response } = await attempt(path);
      expect(response.status).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it.each([
      [['internal', '..', 'admin']],
      [['internal', '%2e%2e', 'admin']],
      [['internal', '%2E%2E', 'admin']],
      [['internal', '.', 'x']],
      [['internal', 'a/../b']],
      [['internal', 'a\\b']],
    ])('rejects path traversal: %j', async (path) => {
      const { calls, response } = await attempt(path);
      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])('rejects the method %s', async (method) => {
      const { calls, response } = await attempt(['internal', 'payments'], method);
      expect(response.status).toBe(405);
      expect(calls).toHaveLength(0);
    });

    it('does not forward set-cookie from the API', async () => {
      const { fetchImpl } = recordingFetch(() => new Response('{}', { headers: { 'set-cookie': 'a=b', 'content-type': 'application/json' } }));
      const response = await forwardToApi(new Request('http://console.test/api/bff/internal/x'), ['internal', 'x'], {
        baseUrl: 'http://api.internal:3000',
        fetch: fetchImpl,
        authenticate: false,
      });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('content-type')).toBe('application/json');
    });

    describe('the chosen Organization', () => {
      const cookie = (access: string, refresh: string) => `pb_access=${access}; pb_refresh=${refresh}`;
      const call = (fetchImpl: typeof fetch, cookies: string, body: string | undefined, method = 'POST') =>
        forwardToApi(
          new Request('http://console.test/api/bff/internal/payments/p1/review-resolution', {
            method,
            headers: { cookie: cookies, 'content-type': 'application/json' },
            body,
          }),
          ['internal', 'payments', 'p1', 'review-resolution'],
          { baseUrl: 'http://api.internal:3000', fetch: fetchImpl },
        );
      const ORG = '6f1f3f0e-3b8e-4c43-9a5c-1f2d3e4f5a6b';
      const orgHeader = (call: { init: RequestInit }) => new Headers(call.init.headers).get('x-organization-id');

      it('forwards the Super Admin\'s choice from the organization cookie as a header', async () => {
        const { calls, fetchImpl } = recordingFetch();
        await call(fetchImpl, `${cookie('access-A', 'refresh-A')}; pb_org=${ORG}`, '{}');
        expect(orgHeader(calls[0]!)).toBe(ORG);
      });

      it('forwards "all" and falls back to nothing for anything else', async () => {
        const all = recordingFetch();
        await call(all.fetchImpl, `${cookie('access-A', 'refresh-A')}; pb_org=all`, undefined, 'GET');
        expect(orgHeader(all.calls[0]!)).toBe('all');

        const junk = recordingFetch();
        await call(junk.fetchImpl, `${cookie('access-A', 'refresh-A')}; pb_org=not-an-id`, undefined, 'GET');
        expect(orgHeader(junk.calls[0]!)).toBeNull();
      });

      it('never lets the browser send the header itself', async () => {
        const { calls, fetchImpl } = recordingFetch();
        await forwardToApi(
          new Request('http://console.test/api/bff/internal/reviews', {
            headers: { cookie: cookie('access-A', 'refresh-A'), 'x-organization-id': ORG },
          }),
          ['internal', 'reviews'],
          { baseUrl: 'http://api.internal:3000', fetch: fetchImpl },
        );
        expect(orgHeader(calls[0]!)).toBeNull();
      });
    });
  });
});
