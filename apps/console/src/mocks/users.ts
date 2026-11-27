/** The mocked Users endpoints, with the API's last-admin rule. */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { ManagedUser } from '@/features/users/api/users';
import { ROLE_LABELS, type ManagedRole } from '@/features/auth/utils/roles';
import type { MockStore } from './store';

export type MockUser = ManagedUser;

export function usersHandlers(
  base: string,
  store: MockStore,
  fail: (
    request: Request,
    init: { status: number; error: string; code: string; message: string },
  ) => Response,
): HttpHandler[] {
  const find = (id: unknown) => store.users.find((u) => u.id === id);
  const lastAdmin = (user: MockUser) =>
    user.role === 'ORGANIZATION_ADMIN' &&
    user.active &&
    !store.users.some(
      (u) => u.id !== user.id && u.role === 'ORGANIZATION_ADMIN' && u.active,
    );
  const refuseLast = (request: Request) =>
    fail(request, {
      status: 409,
      error: 'Conflict',
      code: 'LAST_ORGANIZATION_ADMIN',
      message:
        'The Organization must keep at least one active Organization Admin',
    });
  const notFound = (request: Request) =>
    fail(request, {
      status: 404,
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });

  return [
    http.get(`${base}/internal/users`, () =>
      HttpResponse.json({ items: store.users }),
    ),
    http.post(
      `${base}/internal/users/:id/role`,
      async ({ request, params }) => {
        const user = find(params.id);
        if (!user) return notFound(request);
        const { role } = (await request.json()) as {
          role: ManagedRole;
        };
        if (role !== user.role && lastAdmin(user)) return refuseLast(request);
        Object.assign(user, { role, roleLabel: ROLE_LABELS[role] });
        return HttpResponse.json({});
      },
    ),
    http.post(
      `${base}/internal/users/:id/deactivate`,
      ({ request, params }) => {
        const user = find(params.id);
        if (!user) return notFound(request);
        if (lastAdmin(user)) return refuseLast(request);
        user.active = false;
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.post(
      `${base}/internal/users/:id/reactivate`,
      ({ request, params }) => {
        const user = find(params.id);
        if (!user) return notFound(request);
        user.active = true;
        return new HttpResponse(null, { status: 204 });
      },
    ),
  ];
}
