/**
 * The identity shown in mock mode only. Mock mode has no API and so no
 * sign-in: the Console shows this configured identity (`CONSOLE_OPERATOR_ID`,
 * `CONSOLE_OPERATOR_NAME`). With a real API the signed-in User comes from the
 * session (`./session-user.ts`). Server-side only.
 */
import type { Operator } from '@/features/auth/utils/operator';

export const DEFAULT_OPERATOR: Operator = { id: 'operator', name: 'Operator' };

export function getCurrentOperator(env: Record<string, string | undefined> = process.env): Operator {
  const id = env.CONSOLE_OPERATOR_ID?.trim();
  if (!id) return DEFAULT_OPERATOR;
  return { id, name: env.CONSOLE_OPERATOR_NAME?.trim() || id };
}
