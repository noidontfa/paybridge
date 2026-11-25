'use client';

/**
 * The current Operator on the client side of the auth seam. The root layout
 * (a server component) reads the identity from `src/server/current-operator.ts`
 * and provides it here; components read it with `useCurrentOperator()`.
 */
import { createContext, useContext } from 'react';

export interface Operator {
  /** Recorded as `actor` on every resolution. */
  id: string;
  /** Shown in the sidebar footer. */
  name: string;
}

const OperatorContext = createContext<Operator>({ id: 'operator', name: 'Operator' });

export function OperatorProvider({ operator, children }: { operator: Operator; children: React.ReactNode }) {
  return <OperatorContext.Provider value={operator}>{children}</OperatorContext.Provider>;
}

export function useCurrentOperator(): Operator {
  return useContext(OperatorContext);
}
