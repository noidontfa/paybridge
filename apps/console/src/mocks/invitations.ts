/** The mocked Invitations endpoints: list pending, send, re-send, revoke. */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { INVITABLE_ROLES, type InvitationItem } from '@/features/users/api/invitations';
import { ROLE_LABELS } from '@/lib/roles';
import type { MockStore } from './store';

const WEEK = 7 * 24 * 3_600_000;

export function invitationsHandlers(
  base: string,
  store: MockStore,
  error: (request: Request, init: { status: number; error: string; code: string; message: string }) => Response,
): HttpHandler[] {
  const notFound = (request: Request) =>
    error(request, { status: 404, error: 'Not Found', code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' });

  return [
    http.get(`${base}/internal/invitations`, () => HttpResponse.json({ items: store.invitations })),
    http.post(`${base}/internal/invitations`, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { email?: unknown; role?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const role = INVITABLE_ROLES.find((r) => r === body.role);
      if (!email.includes('@') || !role) {
        return error(request, {
          status: 400,
          error: 'Bad Request',
          code: 'VALIDATION_FAILED',
          message: 'An Invitation needs an email and a Role',
        });
      }
      if (store.users.some((u) => u.email === email)) {
        return error(request, { status: 409, error: 'Conflict', code: 'EMAIL_TAKEN', message: 'That email already has an account' });
      }
      if (store.invitations.some((i) => i.email === email)) {
        return error(request, {
          status: 409,
          error: 'Conflict',
          code: 'INVITATION_PENDING',
          message: 'That email already has a pending Invitation',
        });
      }
      const now = store.clock();
      const created: InvitationItem = {
        id: `inv-${store.invitations.length + 1}`,
        email,
        role,
        roleLabel: ROLE_LABELS[role],
        organizationId: role === 'SUPER_ADMIN' ? null : 'org-default',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + WEEK).toISOString(),
      };
      store.invitations.unshift(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${base}/internal/invitations/:id/resend`, ({ request, params }) => {
      const found = store.invitations.find((i) => i.id === String(params.id));
      if (!found) return notFound(request);
      found.expiresAt = new Date(store.clock().getTime() + WEEK).toISOString();
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${base}/internal/invitations/:id`, ({ request, params }) => {
      const index = store.invitations.findIndex((i) => i.id === String(params.id));
      if (index < 0) return notFound(request);
      store.invitations.splice(index, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
