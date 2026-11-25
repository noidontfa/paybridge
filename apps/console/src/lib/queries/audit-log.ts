'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { statusTransitionEntityTypeSchema } from '@/lib/api/schemas';
import { listStatusTransitions, type AuditEntry, type AuditListQuery } from '@/lib/api/status-transitions';
import type { TableUrlConfig, TableUrlState } from '@/lib/url-state/table-url-state';

/** The audit log is always newest first, so there is nothing to sort in the URL. */
export const AUDIT_URL_CONFIG: TableUrlConfig = {
  filters: ['entityType', 'trigger', 'actor'],
  sortable: [],
  defaultSort: { id: 'createdAt', desc: true },
};

/** Every trigger Core records (`apps/api`), for the filter. */
export const AUDIT_TRIGGERS = [
  'create_payment',
  'start_attempt',
  'gateway_accepted',
  'gateway_rejected',
  'gateway_switch',
  'webhook',
  'status_query',
  'expiry',
  'merchant_cancel',
  'operator_resolution',
  'operator_note',
] as const;

/** The actors Core records: the system, the merchant API, and Operators (one identity until sign-in exists). */
export const AUDIT_ACTORS = ['system', 'merchant', 'operator'] as const;

export const auditKeys = {
  all: ['audit-log'] as const,
  list: (query: AuditListQuery) => [...auditKeys.all, 'list', query] as const,
};

/** The table state as the endpoint's query; an entity type the endpoint would reject is dropped. */
export function auditListQuery(state: TableUrlState): AuditListQuery {
  const entityType = statusTransitionEntityTypeSchema.safeParse(state.filters.entityType);
  return {
    entityType: entityType.success ? entityType.data : undefined,
    trigger: state.filters.trigger,
    actor: state.filters.actor,
  };
}

const EMPTY: AuditEntry[] = [];

export function useAuditList(state: TableUrlState) {
  const query = auditListQuery(state);
  const result = useInfiniteQuery({
    queryKey: auditKeys.list({ ...query, cursor: state.cursor ?? undefined }),
    queryFn: ({ pageParam, signal }) => listStatusTransitions({ ...query, cursor: pageParam }, signal),
    initialPageParam: state.cursor ?? undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = result.data?.pages.flatMap((page) => page.items) ?? EMPTY;
  return { ...result, rows };
}
