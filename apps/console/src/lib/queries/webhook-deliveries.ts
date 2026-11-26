'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWebhookDelivery,
  listWebhookDeliveries,
  resendWebhookDelivery,
  sendTestWebhook,
  type WebhookDeliveryListItem,
  type WebhookDeliveryListQuery,
} from '@/lib/api/webhook-deliveries';
import type { TableUrlConfig, TableUrlState } from '@/lib/url-state/table-url-state';
import { webhookEndpointKeys } from './webhook-endpoints';

export const webhookDeliveryKeys = {
  all: ['webhook-deliveries'] as const,
  list: (query: WebhookDeliveryListQuery) => [...webhookDeliveryKeys.all, 'list', query] as const,
  detail: (id: string) => [...webhookDeliveryKeys.all, 'detail', id] as const,
};

/** Deliveries are always newest first; three filters, no search, no sort. */
export const WEBHOOK_DELIVERY_LIST_URL_CONFIG: TableUrlConfig = {
  filters: ['endpointId', 'status', 'kind'],
  sortable: [],
  defaultSort: { id: 'createdAt', desc: true },
};

const EMPTY: WebhookDeliveryListItem[] = [];

function useDeliveryPages(query: WebhookDeliveryListQuery, cursor?: string) {
  const result = useInfiniteQuery({
    queryKey: webhookDeliveryKeys.list({ ...query, cursor }),
    queryFn: ({ pageParam, signal }) => listWebhookDeliveries({ ...query, cursor: pageParam }, signal),
    initialPageParam: cursor,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = result.data?.pages.flatMap((page) => page.items) ?? EMPTY;
  return { ...result, rows };
}

export function useWebhookDeliveryList(state: TableUrlState) {
  const { endpointId, status, kind } = state.filters;
  return useDeliveryPages({ endpointId, status, kind }, state.cursor ?? undefined);
}

/** One Payment's deliveries, for its detail page. */
export function usePaymentWebhookDeliveries(paymentId: string) {
  return useDeliveryPages({ paymentId });
}

export function useWebhookDelivery(id: string) {
  return useQuery({
    queryKey: webhookDeliveryKeys.detail(id),
    queryFn: ({ signal }) => getWebhookDelivery(id, signal),
  });
}

export function useResendWebhookDelivery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resendWebhookDelivery(id),
    onSuccess: (detail) => {
      client.setQueryData(webhookDeliveryKeys.detail(detail.id), detail);
      void client.invalidateQueries({ queryKey: webhookDeliveryKeys.all });
      void client.invalidateQueries({ queryKey: webhookEndpointKeys.all });
    },
  });
}

export function useSendTestWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (endpointId: string) => sendTestWebhook(endpointId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: webhookDeliveryKeys.all });
      void client.invalidateQueries({ queryKey: webhookEndpointKeys.all });
    },
  });
}
