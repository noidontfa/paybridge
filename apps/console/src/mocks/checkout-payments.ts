/**
 * Mock checkout Payments: every fourth seeded Payment came from the Embedded
 * Checkout, for one of the seeded Pricing Plans, so the Payment detail shows a
 * checkout origin and the Payments list can be filtered by Pricing Plan.
 */
import type { CheckoutOrigin } from '@/lib/api/schemas';
import type { MockStore } from './store';

const CUSTOMERS: Pick<CheckoutOrigin, 'customerReference' | 'customerEmail'>[] = [
  { customerReference: 'user-1042', customerEmail: 'linh@example.com' },
  { customerReference: 'user-2210', customerEmail: null },
  { customerReference: null, customerEmail: 'minh@example.com' },
];

/** Call after `seedPricingPlans`: origins point at the first two seeded plans. */
export function seedCheckoutPayments(store: MockStore): void {
  const plans = store.pricingPlans.slice(0, 2);
  if (plans.length === 0) return;
  store.payments.forEach((payment, index) => {
    if (index % 4 !== 0) return;
    const plan = plans[(index / 4) % plans.length]!;
    const origin: CheckoutOrigin = {
      pricingPlanId: plan.id,
      pricingPlanName: plan.name,
      ...CUSTOMERS[(index / 4) % CUSTOMERS.length]!,
    };
    payment.checkoutOrigin = origin;
    payment.upstreamReference = `chk_${payment.id}`;
    for (const event of store.events) {
      if (event.paymentId !== payment.id) continue;
      event.payload = { ...event.payload, upstreamReference: payment.upstreamReference, checkoutOrigin: origin };
    }
  });
}
