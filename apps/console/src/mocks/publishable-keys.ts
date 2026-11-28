/** The mocked Publishable Keys endpoints, with a simplified origin check. */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { PublishableKey } from '@/features/publishable-keys/api';
import type { MockStore } from './store';

type ErrorInit = { status: number; error: string; code: string; message: string };

/** The API's rule, loosely: each entry must be exactly an origin. Null when valid. */
function originProblem(values: unknown): string | null {
  if (!Array.isArray(values) || values.length === 0) return 'A Publishable Key needs at least one allowed origin';
  for (const value of values) {
    try {
      const url = new URL(String(value));
      if (url.pathname !== '/' || url.search || url.hash) throw new Error();
    } catch {
      return `"${String(value)}" is not an origin (scheme, host and optional port)`;
    }
  }
  return null;
}

const normalise = (values: unknown[]) => [...new Set(values.map((v) => new URL(String(v)).origin))];

const writer = { name: 'Mock Admin', role: 'ORGANIZATION_ADMIN', label: 'Mock Admin' };

export function publishableKeysHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: ErrorInit) => Response,
): HttpHandler[] {
  const invalidOrigins = (request: Request, message: string) =>
    error(request, { status: 400, error: 'Bad Request', code: 'INVALID_ALLOWED_ORIGINS', message });
  const notFound = (request: Request) =>
    error(request, { status: 404, error: 'Not Found', code: 'PUBLISHABLE_KEY_NOT_FOUND', message: 'Publishable Key not found' });

  return [
    http.get(`${base}/internal/publishable-keys`, () =>
      HttpResponse.json({ items: [...store.publishableKeys].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }),
    ),
    http.post(`${base}/internal/publishable-keys`, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { label?: unknown; allowedOrigins?: unknown };
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (!label || label.length > 100) {
        return error(request, {
          status: 400,
          error: 'Bad Request',
          code: 'INVALID_PUBLISHABLE_KEY_LABEL',
          message: 'A Publishable Key needs a label of 1 to 100 characters',
        });
      }
      const problem = originProblem(body.allowedOrigins);
      if (problem) return invalidOrigins(request, problem);
      const now = store.clock().toISOString();
      const created: PublishableKey = {
        id: `pk-${store.publishableKeys.length + 1}`,
        label,
        key: `pb_pk_${Math.random().toString(36).slice(2).padEnd(32, 'x')}`,
        allowedOrigins: normalise(body.allowedOrigins as unknown[]),
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        createdBy: writer,
        updatedBy: writer,
      };
      store.publishableKeys.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${base}/internal/publishable-keys/:id/allowed-origins`, async ({ request, params }) => {
      const index = store.publishableKeys.findIndex((k) => k.id === String(params.id));
      const found = store.publishableKeys[index];
      if (!found) return notFound(request);
      if (found.revokedAt) {
        return error(request, {
          status: 409,
          error: 'Conflict',
          code: 'PUBLISHABLE_KEY_REVOKED',
          message: 'This Publishable Key is revoked',
        });
      }
      const body = (await request.json().catch(() => ({}))) as { allowedOrigins?: unknown };
      const problem = originProblem(body.allowedOrigins);
      if (problem) return invalidOrigins(request, problem);
      const updated = {
        ...found,
        allowedOrigins: normalise(body.allowedOrigins as unknown[]),
        updatedAt: store.clock().toISOString(),
      };
      store.publishableKeys[index] = updated;
      return HttpResponse.json(updated);
    }),
    http.post(`${base}/internal/publishable-keys/:id/revoke`, ({ request, params }) => {
      const found = store.publishableKeys.find((k) => k.id === String(params.id));
      if (!found) return notFound(request);
      found.revokedAt ??= store.clock().toISOString();
      return HttpResponse.json({ revoked: true });
    }),
  ];
}
