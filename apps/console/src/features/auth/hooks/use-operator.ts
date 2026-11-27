'use client';

/**
 * Read the signed-in User (`../utils/operator.ts`) that `<OperatorProvider>`
 * (`../components/operator-provider.tsx`) puts in context.
 */
import { createContext, useContext } from 'react';
import type { Operator } from '../utils/operator';

export const OperatorContext = createContext<Operator | null>(null);

/**
 * Whether the signed-in User holds `permission`. The API refuses the action
 * anyway; this only hides what would be refused. Without a session (mock mode)
 * nothing is hidden.
 */
export function useCan(permission: string): boolean {
  const permissions = useContext(OperatorContext)?.permissions;
  return permissions === undefined || permissions.includes(permission);
}

/** Like `useCan`, for a list of items that each name a Permission. */
export function useCanFn(): (permission: string) => boolean {
  const permissions = useContext(OperatorContext)?.permissions;
  return (permission) => permissions === undefined || permissions.includes(permission);
}

export function useCurrentOperator(): Operator {
  const operator = useContext(OperatorContext);
  if (!operator) throw new Error('useCurrentOperator must be used inside <OperatorProvider>.');
  return operator;
}
