/** The mocked Webhook Endpoints endpoints: create returns the secret once, list never does. */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { WEBHOOK_EVENT_KINDS, type WebhookEndpoint } from '@/lib/api/webhook-endpoints';
import type { MockStore } from './store';
import { isFailingEndpoint } from './webhook-deliveries';

type ErrorInit = { status: number; error: string; code: string; message: string };

const MOCK_ACTOR = { name: 'Mock Admin', role: 'ORGANIZATION_ADMIN', label: null };
const OVERLAP_MS: Record<string, number> = { now: 0, '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000 };
const newSecret = () => `whsec_pb_${Math.random().toString(36).slice(2).padEnd(43, 'x')}`;

function validate(body: { url?: unknown; eventKinds?: unknown }, partial: boolean): string | null {
  if (body.url !== undefined || !partial) {
    if (typeof body.url !== 'string' || !URL.canParse(body.url) || !/^https?:/.test(body.url)) {
      return 'The URL is not valid';
    }
  }
  if (body.eventKinds !== undefined || !partial) {
    const kinds = body.eventKinds;
    if (
      !Array.isArray(kinds) ||
      kinds.length === 0 ||
      !kinds.every((k) => (WEBHOOK_EVENT_KINDS as readonly unknown[]).includes(k))
    ) {
      return 'Choose at least one event kind';
    }
  }
  return null;
}

export function webhookEndpointsHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: ErrorInit) => Response,
): HttpHandler[] {
  const notFound = (request: Request) =>
    error(request, {
      status: 404,
      error: 'Not Found',
      code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
      message: 'Webhook Endpoint not found',
    });
  const invalid = (request: Request, message: string) =>
    error(request, { status: 400, error: 'Bad Request', code: 'INVALID_WEBHOOK_URL', message });
  const find = (id: unknown) => store.webhookEndpoints.find((e) => e.id === String(id));

  return [
    http.get(`${base}/internal/webhook-endpoints`, () =>
      HttpResponse.json({ items: store.webhookEndpoints.map((e) => ({ ...e, failing: isFailingEndpoint(store, e.id) })) }),
    ),
    http.post(`${base}/internal/webhook-endpoints`, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { url?: unknown; eventKinds?: unknown };
      const problem = validate(body, false);
      if (problem) return invalid(request, problem);
      const secret = newSecret();
      const now = store.clock().toISOString();
      const created: WebhookEndpoint = {
        id: `endpoint-${store.webhookEndpoints.length + 1}`,
        url: body.url as string,
        eventKinds: body.eventKinds as string[],
        status: 'ENABLED',
        secretPrefix: secret.slice(0, 15),
        previousSecretExpiresAt: null,
        createdAt: now,
        updatedAt: now,
        updatedBy: MOCK_ACTOR,
      };
      store.webhookEndpoints.push(created);
      return HttpResponse.json({ ...created, secret }, { status: 201 });
    }),
    http.post(`${base}/internal/webhook-endpoints/:id/roll-secret`, async ({ request, params }) => {
      const found = find(params.id);
      if (!found) return notFound(request);
      const body = (await request.json().catch(() => ({}))) as { previousSecretValidFor?: unknown };
      const overlap = OVERLAP_MS[String(body.previousSecretValidFor)];
      if (overlap === undefined) {
        return error(request, {
          status: 400,
          error: 'Bad Request',
          code: 'VALIDATION_FAILED',
          message: 'Choose how long the old secret stays valid',
        });
      }
      const secret = newSecret();
      const now = store.clock();
      found.secretPrefix = secret.slice(0, 15);
      found.previousSecretExpiresAt = overlap > 0 ? new Date(now.getTime() + overlap).toISOString() : null;
      found.updatedAt = now.toISOString();
      return HttpResponse.json({ ...found, secret });
    }),
    http.post(`${base}/internal/webhook-endpoints/:id/:action`, ({ request, params }) => {
      const found = find(params.id);
      if (!found || (params.action !== 'enable' && params.action !== 'disable')) return notFound(request);
      found.status = params.action === 'enable' ? 'ENABLED' : 'DISABLED';
      found.updatedAt = store.clock().toISOString();
      return HttpResponse.json(found);
    }),
    http.post(`${base}/internal/webhook-endpoints/:id`, async ({ request, params }) => {
      const found = find(params.id);
      if (!found) return notFound(request);
      const body = (await request.json().catch(() => ({}))) as { url?: unknown; eventKinds?: unknown };
      const problem = validate(body, true);
      if (problem) return invalid(request, problem);
      if (typeof body.url === 'string') found.url = body.url;
      if (Array.isArray(body.eventKinds)) found.eventKinds = body.eventKinds as string[];
      found.updatedAt = store.clock().toISOString();
      return HttpResponse.json(found);
    }),
    http.delete(`${base}/internal/webhook-endpoints/:id`, ({ request, params }) => {
      const index = store.webhookEndpoints.findIndex((e) => e.id === String(params.id));
      if (index < 0) return notFound(request);
      store.webhookEndpoints.splice(index, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
