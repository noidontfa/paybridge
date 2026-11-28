'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPricingTable,
  deletePricingTable,
  getPricingTable,
  listPricingTables,
  updatePricingTable,
  type PricingTableInput,
} from '@/features/pricing-tables/api';
import { pricingPlanKeys } from '@/features/pricing-plans/hooks/queries';

export const pricingTableKeys = {
  all: ['pricing-tables'] as const,
  list: () => [...pricingTableKeys.all, 'list'] as const,
  detail: (id: string) => [...pricingTableKeys.all, 'detail', id] as const,
};

export function usePricingTables() {
  return useQuery({ queryKey: pricingTableKeys.list(), queryFn: ({ signal }) => listPricingTables(signal) });
}

export function usePricingTable(id: string) {
  return useQuery({ queryKey: pricingTableKeys.detail(id), queryFn: ({ signal }) => getPricingTable(id, signal) });
}

/** A Pricing Plan's detail lists its Pricing Tables, so both caches refresh. */
function useInvalidating<A, R>(fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: pricingTableKeys.all });
      await client.invalidateQueries({ queryKey: pricingPlanKeys.all });
    },
  });
}

export function useCreatePricingTable() {
  return useInvalidating((input: PricingTableInput) => createPricingTable(input));
}

export function useUpdatePricingTable() {
  return useInvalidating(({ id, input }: { id: string; input: PricingTableInput }) => updatePricingTable(id, input));
}

export function useDeletePricingTable() {
  return useInvalidating((id: string) => deletePricingTable(id));
}
