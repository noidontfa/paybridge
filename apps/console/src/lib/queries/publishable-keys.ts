'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPublishableKey,
  listPublishableKeys,
  revokePublishableKey,
  setPublishableKeyOrigins,
} from '@/lib/api/publishable-keys';

export const publishableKeyKeys = {
  all: ['publishable-keys'] as const,
  list: () => [...publishableKeyKeys.all, 'list'] as const,
};

export function usePublishableKeys() {
  return useQuery({ queryKey: publishableKeyKeys.list(), queryFn: ({ signal }) => listPublishableKeys(signal) });
}

export function useCreatePublishableKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { label: string; allowedOrigins: string[] }) => createPublishableKey(input),
    onSuccess: () => client.invalidateQueries({ queryKey: publishableKeyKeys.all }),
  });
}

export function useSetPublishableKeyOrigins() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, allowedOrigins }: { id: string; allowedOrigins: string[] }) =>
      setPublishableKeyOrigins(id, allowedOrigins),
    onSuccess: () => client.invalidateQueries({ queryKey: publishableKeyKeys.all }),
  });
}

export function useRevokePublishableKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokePublishableKey(id),
    onSuccess: () => client.invalidateQueries({ queryKey: publishableKeyKeys.all }),
  });
}
