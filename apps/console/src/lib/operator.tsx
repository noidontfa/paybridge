'use client';

/**
 * The signed-in User on the client side. The root layout (a server component)
 * reads the session (`src/server/session-user.ts`) and provides it here;
 * components read it with `useCurrentOperator()`. The API records the acting
 * User from the access token: the browser never sends who it is.
 */
import { createContext, useContext } from 'react';

export interface Operator {
  id: string;
  /** Shown in the sidebar footer. */
  name: string;
  /** The Role, as the API names it (`OPERATOR`, ...). Absent in mock mode. */
  role?: string;
  /** The Organization's name; null for a Super Admin. Absent in mock mode. */
  organization?: string | null;
}

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORGANIZATION_ADMIN: 'Organization Admin',
  OPERATOR: 'Operator',
};

/** "Operator · Acme Retail", or just the Role for a Super Admin. */
export function describeOperator(operator: Operator): string | null {
  if (!operator.role) return null;
  const role = ROLE_LABELS[operator.role] ?? operator.role;
  return operator.organization ? `${role} · ${operator.organization}` : role;
}

const OperatorContext = createContext<Operator | null>(null);

export function OperatorProvider({ operator, children }: { operator: Operator; children: React.ReactNode }) {
  return <OperatorContext.Provider value={operator}>{children}</OperatorContext.Provider>;
}

export function useCurrentOperator(): Operator {
  const operator = useContext(OperatorContext);
  if (!operator) throw new Error('useCurrentOperator must be used inside <OperatorProvider>.');
  return operator;
}
