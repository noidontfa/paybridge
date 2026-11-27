'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createGatewayConnection,
  deleteGatewayConnection,
  listGatewayConnections,
  replaceGatewayCredentials,
  setGatewayConnectionEnabled,
} from '@/features/gateway-connections/api';

export const gatewayConnectionKeys = {
  all: ['gateway-connections'] as const,
};

export function useGatewayConnections() {
  return useQuery({ queryKey: gatewayConnectionKeys.all, queryFn: ({ signal }) => listGatewayConnections(signal) });
}

/** Every change refetches the list; the toast lives here so it survives the form closing. */
function useChange<V, R>(fn: (value: V) => Promise<R>, message: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(message);
      await client.invalidateQueries({ queryKey: gatewayConnectionKeys.all });
    },
  });
}

export const useConnectGateway = () => useChange(createGatewayConnection, 'Gateway connected.');
export const useReplaceCredentials = () =>
  useChange((v: { id: string; credentials: Record<string, string> }) => replaceGatewayCredentials(v.id, v.credentials), 'Credentials replaced.');
export const useSetConnectionEnabled = () =>
  useChange((v: { id: string; enabled: boolean }) => setGatewayConnectionEnabled(v.id, v.enabled), 'Gateway Connection updated.');
export const useDeleteConnection = () => useChange(deleteGatewayConnection, 'Gateway Connection deleted.');
