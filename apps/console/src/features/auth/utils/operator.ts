/**
 * The signed-in User as the Console sees it. The root layout (a server
 * component) reads the session (`server/session-user.ts`) and provides it with
 * `<OperatorProvider>` (`../components/operator-provider.tsx`); components read
 * it with `useCurrentOperator()` (`../hooks/use-operator.ts`). The API records
 * the acting User from the access token: the browser never sends who it is.
 */
import { ROLE_LABELS, type UserRole } from './roles';

export interface Operator {
  id: string;
  /** Shown in the sidebar footer. */
  name: string;
  /** The Role, as the API names it (`OPERATOR`, ...). Absent in mock mode. */
  role?: string;
  /** The Organization's name; null for a Super Admin. Absent in mock mode. */
  organization?: string | null;
  /** What the User may do (the API's Permission names). Absent in mock mode: everything is allowed. */
  permissions?: string[];
}

/** "Operator · Acme Retail", or just the Role for a Super Admin. */
export function describeOperator(operator: Operator): string | null {
  if (!operator.role) return null;
  const role = ROLE_LABELS[operator.role as UserRole] ?? operator.role;
  return operator.organization ? `${role} · ${operator.organization}` : role;
}
