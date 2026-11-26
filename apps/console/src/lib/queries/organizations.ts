'use client';

import { useQuery } from '@tanstack/react-query';
import { listOrganizations } from '@/lib/api/organizations';

export const organizationKeys = {
  all: ['organizations'] as const,
  list: () => [...organizationKeys.all, 'list'] as const,
};

export function useOrganizationList(enabled = true) {
  return useQuery({
    queryKey: organizationKeys.list(),
    queryFn: ({ signal }) => listOrganizations(signal),
    enabled,
  });
}
