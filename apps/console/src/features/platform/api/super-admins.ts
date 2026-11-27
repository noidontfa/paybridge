/**
 * The platform team (`/internal/super-admins`). Every write needs the
 * Permission to manage Super Admins. A Super Admin's Role never changes.
 */
import { z } from 'zod';
import { request } from '@/services/client';
import { managedUserListSchema } from '@/features/users/api/users';

export function listSuperAdmins(signal?: AbortSignal) {
  return request('/internal/super-admins', managedUserListSchema, { signal });
}

const invitedSchema = z.object({ id: z.string(), email: z.string(), expiresAt: z.string() });

export function inviteSuperAdmin(email: string) {
  return request('/internal/super-admins/invitations', invitedSchema, { method: 'POST', body: { email } });
}

const nothing = z.unknown();
const path = (id: string, action: string) => `/internal/super-admins/${encodeURIComponent(id)}/${action}`;

export function deactivateSuperAdmin(id: string) {
  return request(path(id, 'deactivate'), nothing, { method: 'POST' });
}

export function reactivateSuperAdmin(id: string) {
  return request(path(id, 'reactivate'), nothing, { method: 'POST' });
}
