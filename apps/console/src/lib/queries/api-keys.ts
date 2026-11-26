'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/api/api-keys';

export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: () => [...apiKeyKeys.all, 'list'] as const,
};

export function useApiKeys() {
  return useQuery({ queryKey: apiKeyKeys.list(), queryFn: ({ signal }) => listApiKeys(signal) });
}

export function useCreateApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => createApiKey(label),
    onSuccess: () => client.invalidateQueries({ queryKey: apiKeyKeys.all }),
  });
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => client.invalidateQueries({ queryKey: apiKeyKeys.all }),
  });
}
