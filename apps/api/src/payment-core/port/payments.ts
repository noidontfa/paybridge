// Part of Payment Core's public surface for other modules: what the Embedded
// Checkout may do with Payments. Import `PaymentCoreModule` from here to get
// `CheckoutPayments` injected; nothing else of Core's application is public.
export { PaymentCoreModule } from '../payment-core.module.js';
export {
  CHECKOUT_UPSTREAM_REFERENCE_PREFIX,
  CheckoutPayments,
  type CheckoutAttemptInput,
  type CheckoutAttemptView,
  type CheckoutPaymentView,
  type NewCheckoutPayment,
} from '../application/checkout-payments.js';
export type { CheckoutOrigin } from '../domain/entities/payment.js';
export type { AttemptStatus, PaymentStatus } from '../domain/statuses.js';
