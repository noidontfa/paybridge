'use client';

import { OperatorContext } from '../hooks/use-operator';
import type { Operator } from '../utils/operator';

export function OperatorProvider({ operator, children }: { operator: Operator; children: React.ReactNode }) {
  return <OperatorContext.Provider value={operator}>{children}</OperatorContext.Provider>;
}
