/**
 * The auth seam (spec, "Auth seam"). There is no authentication in v1: the
 * Console is reached on the internal network only, so the current Operator is
 * a configured identity (`CONSOLE_OPERATOR_ID`, `CONSOLE_OPERATOR_NAME`).
 *
 * Real authentication replaces only this module (reading the session instead
 * of the environment) and adds a middleware check; its two consumers do not
 * change: the BFF proxy sets `actor` from it on write calls, and the root
 * layout hands it to the UI (`OperatorProvider`, `useCurrentOperator()`) for
 * the sidebar footer. Server-side only; the browser never supplies it.
 */
import type { Operator } from '@/lib/operator';

export const DEFAULT_OPERATOR: Operator = { id: 'operator', name: 'Operator' };

export function getCurrentOperator(env: Record<string, string | undefined> = process.env): Operator {
  const id = env.CONSOLE_OPERATOR_ID?.trim();
  if (!id) return DEFAULT_OPERATOR;
  return { id, name: env.CONSOLE_OPERATOR_NAME?.trim() || id };
}
