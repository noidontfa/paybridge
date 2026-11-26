/** The mocked Platform endpoints: Organizations and Super Admins, with the API's last-Super-Admin rule. */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { MockStore } from './store';

type Fail = (
  request: Request,
  init: { status: number; error: string; code: string; message: string },
) => Response;

export function platformHandlers(base: string, store: MockStore, fail: Fail): HttpHandler[] {
  const notFound = (request: Request, code: string, message: string) =>
    fail(request, { status: 404, error: 'Not Found', code, message });
  const conflict = (request: Request, code: string, message: string) =>
    fail(request, { status: 409, error: 'Conflict', code, message });
  const findOrganization = (id: unknown) => store.organizations.find((o) => o.id === id);
  const findSuperAdmin = (id: unknown) => store.superAdmins.find((u) => u.id === id);

  return [
    http.get(`${base}/internal/organizations`, () => HttpResponse.json({ items: store.organizations })),
    http.post(`${base}/internal/organizations`, async ({ request }) => {
      const { name, adminEmail } = (await request.json()) as { name: string; adminEmail: string };
      const taken = [...store.users, ...store.superAdmins].some((u) => u.email === adminEmail);
      if (taken) return conflict(request, 'EMAIL_TAKEN', `A User with email ${adminEmail} already exists`);
      const created = {
        id: `org-${store.organizations.length + 1}`,
        name,
        status: 'ACTIVE' as const,
        createdAt: store.clock().toISOString(),
      };
      store.organizations.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`${base}/internal/organizations/:id/suspend`, ({ request, params }) => {
      const organization = findOrganization(params.id);
      if (!organization) return notFound(request, 'ORGANIZATION_NOT_FOUND', 'Organization not found');
      organization.status = 'SUSPENDED';
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${base}/internal/organizations/:id/reactivate`, ({ request, params }) => {
      const organization = findOrganization(params.id);
      if (!organization) return notFound(request, 'ORGANIZATION_NOT_FOUND', 'Organization not found');
      organization.status = 'ACTIVE';
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${base}/internal/super-admins`, () => HttpResponse.json({ items: store.superAdmins })),
    http.post(`${base}/internal/super-admins/invitations`, async ({ request }) => {
      const { email } = (await request.json()) as { email: string };
      if ([...store.users, ...store.superAdmins].some((u) => u.email === email)) {
        return conflict(request, 'EMAIL_TAKEN', `A User with email ${email} already exists`);
      }
      return HttpResponse.json(
        { id: `invitation-${email}`, email, expiresAt: store.clock().toISOString() },
        { status: 201 },
      );
    }),
    http.post(`${base}/internal/super-admins/:id/deactivate`, ({ request, params }) => {
      const admin = findSuperAdmin(params.id);
      if (!admin) return notFound(request, 'USER_NOT_FOUND', 'Super Admin not found');
      const others = store.superAdmins.some((u) => u.id !== admin.id && u.active);
      if (admin.active && !others) {
        return conflict(request, 'LAST_SUPER_ADMIN', 'The platform must keep at least one active Super Admin');
      }
      admin.active = false;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${base}/internal/super-admins/:id/reactivate`, ({ request, params }) => {
      const admin = findSuperAdmin(params.id);
      if (!admin) return notFound(request, 'USER_NOT_FOUND', 'Super Admin not found');
      admin.active = true;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
