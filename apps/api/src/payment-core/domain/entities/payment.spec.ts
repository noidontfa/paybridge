import type { PaymentChanges } from './payment.js';

// Invariants 1 and 2: amount and upstream reference never change after
// creation. The only write path for an existing Payment is
// `PaymentRepository.update(id, changes: PaymentChanges)`, so neither field may
// ever become part of PaymentChanges. Checked by `pnpm typecheck`.
describe('PaymentChanges', () => {
  it('can change only the status', () => {
    expectTypeOf<keyof PaymentChanges>().toEqualTypeOf<'status'>();
  });
});
