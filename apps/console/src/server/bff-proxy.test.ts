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
      headers: { 'content-type': 'application/json', cookie: 'secret=1' },
      body: JSON.stringify({ note: 'n' }),
    });

    const response = await forwardToApi(request, ['internal', 'payments', 'p 1', 'other-write'], {
      baseUrl: 'http://api.internal:3000/',
      fetch: fetchImpl,
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

  describe('review resolution', () => {
    const OPERATOR = { id: 'op-7', name: 'Dana Operator' };
    const send = async (body: BodyInit | undefined, path = ['internal', 'payments', 'p1', 'review-resolution'], method = 'POST') => {
      const { calls, fetchImpl } = recordingFetch();
      await forwardToApi(new Request(`http://console.test/api/bff/${path.join('/')}`, { method, body }), path, {
        baseUrl: 'http://api.internal:3000',
        fetch: fetchImpl,
        operator: () => OPERATOR,
      });
      return calls[0]!;
    };
    const sentBody = (call: { init: RequestInit }) => JSON.parse(new TextDecoder().decode(call.init.body as ArrayBuffer));

    it('sets actor from the current Operator', async () => {
      const call = await send(JSON.stringify({ attemptId: 'a1', note: 'n', status: 'FAILED' }));
      expect(sentBody(call)).toEqual({ attemptId: 'a1', note: 'n', status: 'FAILED', actor: 'op-7' });
    });

    it('ignores an actor sent by the browser', async () => {
      const call = await send(JSON.stringify({ attemptId: 'a1', note: 'n', actor: 'someone-else' }));
      expect(sentBody(call).actor).toBe('op-7');
    });

    it('leaves other writes and other methods untouched', async () => {
      const other = await send(JSON.stringify({ actor: 'x' }), ['internal', 'payments', 'p1', 'something']);
      expect(sentBody(other)).toEqual({ actor: 'x' });
      const get = await send(undefined, ['internal', 'payments', 'p1', 'review-resolution'], 'GET');
      expect(get.init.body).toBeUndefined();
    });

    it('forwards a body that is not a JSON object unchanged, for the API to reject', async () => {
      const call = await send('not json');
      expect(new TextDecoder().decode(call.init.body as ArrayBuffer)).toBe('not json');
    });
  });
});
