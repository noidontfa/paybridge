'use client';

/**
 * Query keys and hooks for Payments. One key factory per resource, so a
 * mutation can invalidate precisely (ticket 06 invalidates `paymentKeys.detail`).
 */
import { useQuery } from '@tanstack/react-query';
import { getOperatorPayment } from '@/services/client';

export const paymentKeys = {
  all: ['payments'] as const,
  detail: (id: string) => [...paymentKeys.all, 'detail', id] as const,
};

export function usePayment(id: string) {
  return useQuery({
    queryKey: paymentKeys.detail(id),
    queryFn: ({ signal }) => getOperatorPayment(id, signal),
  });
}
