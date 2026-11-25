'use client';

import { useQuery } from '@tanstack/react-query';
import { getGateway, listGateways } from '@/lib/api/gateways';

export const gatewayKeys = {
  all: ['gateways'] as const,
  list: () => [...gatewayKeys.all, 'list'] as const,
  detail: (id: string) => [...gatewayKeys.all, 'detail', id] as const,
};

export function useGatewayList() {
  return useQuery({ queryKey: gatewayKeys.list(), queryFn: ({ signal }) => listGateways(signal) });
}

export function useGateway(id: string) {
  return useQuery({ queryKey: gatewayKeys.detail(id), queryFn: ({ signal }) => getGateway(id, signal) });
}
