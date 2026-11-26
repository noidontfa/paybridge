/** The mocked API Keys endpoints: create returns the key once, list never does. */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { ApiKey } from '@/lib/api/api-keys';
import type { MockStore } from './store';

export function apiKeysHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: { status: number; error: string; code: string; message: string }) => Response,
): HttpHandler[] {
  return [
    http.get(`${base}/internal/api-keys`, () =>
      HttpResponse.json({ items: [...store.apiKeys].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }),
    ),
    http.post(`${base}/internal/api-keys`, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { label?: unknown };
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (!label || label.length > 100) {
        return error(request, {
          status: 400,
          error: 'Bad Request',
          code: 'INVALID_API_KEY_LABEL',
          message: 'An API Key needs a label of 1 to 100 characters',
        });
      }
      const secret = `pb_live_${Math.random().toString(36).slice(2).padEnd(24, 'x')}`;
      const created: ApiKey = {
        id: `key-${store.apiKeys.length + 1}`,
        label,
        prefix: secret.slice(0, 16),
        createdAt: store.clock().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      store.apiKeys.push(created);
      return HttpResponse.json({ ...created, key: secret }, { status: 201 });
    }),
    http.post(`${base}/internal/api-keys/:id/revoke`, ({ request, params }) => {
      const found = store.apiKeys.find((k) => k.id === String(params.id));
      if (!found) {
        return error(request, { status: 404, error: 'Not Found', code: 'API_KEY_NOT_FOUND', message: 'API Key not found' });
      }
      found.revokedAt ??= store.clock().toISOString();
      return HttpResponse.json({ revoked: true });
    }),
  ];
}
