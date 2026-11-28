import type { PricingPlan } from '../entities/pricing-plan.js';
import { CheckoutUnavailableError } from '../errors.js';

/**
 * The PaymentGateways a Customer may pay a Pricing Plan with: those the plan
 * allows (an empty list allows every one) that the Organization has enabled.
 */
export function sellableGatewayIds(
  plan: Pick<PricingPlan, 'allowedGatewayIds'>,
  enabledGatewayIds: readonly string[],
): string[] {
  if (plan.allowedGatewayIds.length === 0) return [...enabledGatewayIds];
  return enabledGatewayIds.filter((id) => plan.allowedGatewayIds.includes(id));
}

/** Refuses a gateway the plan does not allow, or one that is not enabled. */
export function assertGatewaySellable(
  plan: Pick<PricingPlan, 'allowedGatewayIds'>,
  enabledGatewayIds: readonly string[],
  gatewayId: string,
): void {
  const allowed =
    plan.allowedGatewayIds.length === 0 ||
    plan.allowedGatewayIds.includes(gatewayId);
  if (!allowed) throw new CheckoutUnavailableError('GATEWAY_NOT_ALLOWED');
  if (!enabledGatewayIds.includes(gatewayId)) {
    throw new CheckoutUnavailableError('GATEWAY_NOT_ENABLED');
  }
}
