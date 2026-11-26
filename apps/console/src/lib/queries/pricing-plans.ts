'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archivePricingPlan,
  createPricingPlan,
  deletePricingPlan,
  getPricingPlan,
  listPricingPlans,
  restorePricingPlan,
  updatePricingPlan,
  type PricingPlanInput,
} from '@/lib/api/pricing-plans';

export const pricingPlanKeys = {
  all: ['pricing-plans'] as const,
  list: () => [...pricingPlanKeys.all, 'list'] as const,
  detail: (id: string) => [...pricingPlanKeys.all, 'detail', id] as const,
};

export function usePricingPlans() {
  return useQuery({ queryKey: pricingPlanKeys.list(), queryFn: ({ signal }) => listPricingPlans(signal) });
}

export function usePricingPlan(id: string) {
  return useQuery({ queryKey: pricingPlanKeys.detail(id), queryFn: ({ signal }) => getPricingPlan(id, signal) });
}

function useInvalidating<A, R>(fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: pricingPlanKeys.all }),
  });
}

export function useCreatePricingPlan() {
  return useInvalidating((input: PricingPlanInput) => createPricingPlan(input));
}

export function useUpdatePricingPlan() {
  return useInvalidating(({ id, input }: { id: string; input: PricingPlanInput }) => updatePricingPlan(id, input));
}

export function useArchivePricingPlan() {
  return useInvalidating((id: string) => archivePricingPlan(id));
}

export function useRestorePricingPlan() {
  return useInvalidating((id: string) => restorePricingPlan(id));
}

export function useDeletePricingPlan() {
  return useInvalidating((id: string) => deletePricingPlan(id));
}
