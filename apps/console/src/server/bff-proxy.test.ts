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
    const request = new Request('http://console.test/api/bff/internal/payments/p%201/review-resolution?a=1&b=x%20y', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'secret=1' },
      body: JSON.stringify({ note: 'n' }),
    });

    const response = await forwardToApi(request, ['internal', 'payments', 'p 1', 'review-resolution'], {
      baseUrl: 'http://api.internal:3000/',
      fetch: fetchImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.internal:3000/internal/payments/p%201/review-resolution?a=1&b=x%20y');
    expect(calls[0]?.init.method).toBe('POST');
    expect(new TextDecoder().decode(calls[0]?.init.body as ArrayBuffer)).toBe('{"note":"n"}');
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(calls[0]?.init.headers).get('cookie')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });

  it('sends no body for GET and passes the API status through', async () => {
    const { calls, fetchImpl } = recordingFetch(() => Response.json({ message: 'gone' }, { status: 404 }));
    const response = await forwardToApi(new Request('http://console.test/api/bff/payments/x'), ['payments', 'x'], {
      baseUrl: 'http://api.internal:3000',
      fetch: fetchImpl,
    });
    expect(calls[0]?.init.body).toBeUndefined();
    expect(response.status).toBe(404);
  });

  it('answers 502 in the API error shape when the API is unreachable', async () => {
    const response = await forwardToApi(new Request('http://console.test/api/bff/payments/x'), ['payments', 'x'], {
      baseUrl: 'http://api.internal:3000',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ statusCode: 502, code: 'API_UNREACHABLE' });
  });
});
