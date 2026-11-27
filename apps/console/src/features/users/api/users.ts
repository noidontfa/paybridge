/**
 * The Organization's Users: `GET /internal/users`, and the sensitive writes
 * that change a Role, deactivate or reactivate a User. Needs the Permission to
 * manage Users. The BFF forwards GET, HEAD, POST and DELETE only, so a Role change is a POST.
 */
import { z } from 'zod';
import { MANAGED_ROLES, USER_ROLES, type ManagedRole } from '@/lib/roles';
import { request } from '@/services/client';

export const managedRoleSchema = z.enum(MANAGED_ROLES);
export type { ManagedRole };

export const managedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  roleLabel: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

export const managedUserListSchema = z.object({
  items: z.array(managedUserSchema),
});

const nothingSchema = z.unknown();

const userPath = (id: string, action: string) =>
  `/internal/users/${encodeURIComponent(id)}/${action}`;

export function listUsers(signal?: AbortSignal) {
  return request('/internal/users', managedUserListSchema, { signal });
}

export function changeUserRole(id: string, role: ManagedRole) {
  return request(userPath(id, 'role'), nothingSchema, {
    method: 'POST',
    body: { role },
  });
}

export function deactivateUser(id: string) {
  return request(userPath(id, 'deactivate'), nothingSchema, { method: 'POST' });
}

export function reactivateUser(id: string) {
  return request(userPath(id, 'reactivate'), nothingSchema, { method: 'POST' });
}
