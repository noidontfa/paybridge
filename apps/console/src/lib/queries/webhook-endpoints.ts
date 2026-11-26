'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  rollWebhookEndpointSecret,
  setWebhookEndpointEnabled,
  updateWebhookEndpoint,
  type SecretOverlap,
  type WebhookEndpointInput,
} from '@/lib/api/webhook-endpoints';

export const webhookEndpointKeys = {
  all: ['webhook-endpoints'] as const,
  list: () => [...webhookEndpointKeys.all, 'list'] as const,
};

export function useWebhookEndpoints() {
  return useQuery({ queryKey: webhookEndpointKeys.list(), queryFn: ({ signal }) => listWebhookEndpoints(signal) });
}

function useInvalidating<T, R>(mutationFn: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: webhookEndpointKeys.all }),
  });
}

export function useCreateWebhookEndpoint() {
  return useInvalidating((input: WebhookEndpointInput) => createWebhookEndpoint(input));
}

export function useUpdateWebhookEndpoint() {
  return useInvalidating(({ id, ...input }: { id: string } & Partial<WebhookEndpointInput>) =>
    updateWebhookEndpoint(id, input),
  );
}

export function useSetWebhookEndpointEnabled() {
  return useInvalidating(({ id, enabled }: { id: string; enabled: boolean }) => setWebhookEndpointEnabled(id, enabled));
}

export function useDeleteWebhookEndpoint() {
  return useInvalidating((id: string) => deleteWebhookEndpoint(id));
}

export function useRollWebhookEndpointSecret() {
  return useInvalidating(({ id, overlap }: { id: string; overlap: SecretOverlap }) =>
    rollWebhookEndpointSecret(id, overlap),
  );
}
