/**
 * Organizations (`/internal/organizations`): the list a Super Admin switches
 * between, and the Platform area's sensitive writes (create with the first
 * Organization Admin's Invitation, suspend, reactivate). All need the
 * Permission to manage Organizations.
 */
import { z } from 'zod';
import { request } from './client';

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  createdAt: z.string().optional(),
});
export type OrganizationSummary = z.infer<typeof organizationSchema>;

export const organizationListSchema = z.object({ items: z.array(organizationSchema) });
export type OrganizationList = z.infer<typeof organizationListSchema>;

export function listOrganizations(signal?: AbortSignal): Promise<OrganizationList> {
  return request('/internal/organizations', organizationListSchema, { signal });
}

export function createOrganization(input: { name: string; adminEmail: string }) {
  return request('/internal/organizations', organizationSchema, { method: 'POST', body: input });
}

const nothing = z.unknown();
const organizationPath = (id: string, action: string) => `/internal/organizations/${encodeURIComponent(id)}/${action}`;

export function suspendOrganization(id: string) {
  return request(organizationPath(id, 'suspend'), nothing, { method: 'POST' });
}

export function reactivateOrganization(id: string) {
  return request(organizationPath(id, 'reactivate'), nothing, { method: 'POST' });
}
