/**
 * `GET /internal/organizations`: the Organizations a Super Admin can switch
 * between. Needs the Permission to manage Organizations.
 */
import { z } from 'zod';
import { request } from './client';

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});
export type OrganizationSummary = z.infer<typeof organizationSchema>;

export const organizationListSchema = z.object({ items: z.array(organizationSchema) });
export type OrganizationList = z.infer<typeof organizationListSchema>;

export function listOrganizations(signal?: AbortSignal): Promise<OrganizationList> {
  return request('/internal/organizations', organizationListSchema, { signal });
}
