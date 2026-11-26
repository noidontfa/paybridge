/**
 * The mocked Gateway Connections endpoints. Like the API, they never return
 * credentials, only the names of the fields that are set.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { CREDENTIAL_FIELDS, type GatewayConnection } from '@/lib/api/gateway-connections';
import type { MockStore } from './store';

export function gatewayConnectionsHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: { status: number; error: string; code: string; message: string }) => Response,
): HttpHandler[] {
  const path = `${base}/internal/gateway-connections`;
  const notFound = (request: Request) =>
    error(request, { status: 404, error: 'Not Found', code: 'GATEWAY_CONNECTION_NOT_FOUND', message: 'Gateway Connection not found' });
  const fieldsOf = (credentials: unknown): string[] =>
    credentials && typeof credentials === 'object' ? Object.keys(credentials).sort() : [];
  const find = (id: unknown) => store.gatewayConnections.find((c) => c.id === String(id));
  const touch = (connection: GatewayConnection) => {
    connection.updatedAt = store.clock().toISOString();
  };

  return [
    http.get(path, () => HttpResponse.json({ items: store.gatewayConnections })),
    http.post(path, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { gatewayId?: unknown; credentials?: unknown };
      const gateway = store.gateways.find((g) => g.id === body.gatewayId);
      if (!gateway) {
        return error(request, { status: 400, error: 'Bad Request', code: 'UNKNOWN_GATEWAY', message: 'Unknown gateway' });
      }
      if (store.gatewayConnections.some((c) => c.gatewayId === gateway.id)) {
        return error(request, {
          status: 409,
          error: 'Conflict',
          code: 'GATEWAY_ALREADY_CONNECTED',
          message: `Gateway ${gateway.id} is already connected`,
        });
      }
      const now = store.clock().toISOString();
      const created: GatewayConnection = {
        id: `conn-${store.gatewayConnections.length + 1}`,
        organizationId: 'org-default',
        gatewayId: gateway.id,
        enabled: true,
        credentialsVersion: 1,
        credentialFields: CREDENTIAL_FIELDS[gateway.id] ? fieldsOf(body.credentials) : [],
        createdAt: now,
        updatedAt: now,
      };
      store.gatewayConnections.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${path}/:id/credentials`, async ({ request, params }) => {
      const found = find(params.id);
      if (!found) return notFound(request);
      const body = (await request.json().catch(() => ({}))) as { credentials?: unknown };
      found.credentialFields = fieldsOf(body.credentials);
      found.credentialsVersion += 1;
      touch(found);
      return HttpResponse.json(found);
    }),
    http.post(`${path}/:id/enable`, ({ request, params }) => {
      const found = find(params.id);
      if (!found) return notFound(request);
      found.enabled = true;
      touch(found);
      return HttpResponse.json(found);
    }),
    http.post(`${path}/:id/disable`, ({ request, params }) => {
      const found = find(params.id);
      if (!found) return notFound(request);
      found.enabled = false;
      touch(found);
      return HttpResponse.json(found);
    }),
    http.delete(`${path}/:id`, ({ request, params }) => {
      const index = store.gatewayConnections.findIndex((c) => c.id === String(params.id));
      if (index < 0) return notFound(request);
      store.gatewayConnections.splice(index, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
