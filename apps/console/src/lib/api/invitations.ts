/**
 * Invitation management (`/internal/invitations`). Every write needs the
 * Permission to manage Users and is re-checked by the API in the database.
 */
import { z } from 'zod';
import { request } from './client';

export const INVITABLE_ROLES = ['OPERATOR', 'ORGANIZATION_ADMIN', 'SUPER_ADMIN'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(INVITABLE_ROLES),
  roleLabel: z.string(),
  organizationId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type InvitationItem = z.infer<typeof invitationSchema>;

export const invitationListSchema = z.object({ items: z.array(invitationSchema) });

export function listInvitations(signal?: AbortSignal) {
  return request('/internal/invitations', invitationListSchema, { signal });
}

export function sendInvitation(input: { email: string; role: InvitableRole }) {
  return request('/internal/invitations', invitationSchema, { method: 'POST', body: input });
}

const nothing = z.unknown();

export function resendInvitation(id: string) {
  return request(`/internal/invitations/${encodeURIComponent(id)}/resend`, nothing, { method: 'POST' });
}

export function revokeInvitation(id: string) {
  return request(`/internal/invitations/${encodeURIComponent(id)}`, nothing, { method: 'DELETE' });
}
