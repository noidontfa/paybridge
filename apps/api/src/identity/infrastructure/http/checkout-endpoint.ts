import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import {
  PRINCIPAL_REQUEST_KEY,
  type Principal,
} from '../../../common/principal/principal.js';
import { GLOBAL_PREFIX } from '../../../constants.js';
import type { CheckoutCaller } from '../../application/use-cases/publishable-keys.js';

/** Metadata key the access guard reads. */
export const IS_CHECKOUT_ENDPOINT = 'identity:checkout-endpoint';

/**
 * The path checkout endpoints live under (`/api/checkout/...`). Identity
 * authenticates a Publishable Key there, and only there.
 */
export const CHECKOUT_PATH = `/${GLOBAL_PREFIX}/checkout`;

/**
 * Sent by the checkout app's iframe page: the origin of the host page it is
 * embedded in. Honoured only from the checkout app's own origins.
 */
export const HOST_ORIGIN_HEADER = 'x-paybridge-host-origin';

export function isCheckoutPath(path: string): boolean {
  return path === CHECKOUT_PATH || path.startsWith(`${CHECKOUT_PATH}/`);
}

/**
 * Marks a controller or route as a checkout endpoint (ADR 0009): it is served
 * under `/api/checkout/...` and accepts only a Publishable Key from one of
 * its allowed origins. The access guard refuses every other credential here,
 * and refuses a Publishable Key on every route without this marker.
 */
export const CheckoutEndpoint = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_CHECKOUT_ENDPOINT, true);

/** The checkout caller of a `@CheckoutEndpoint()` route. */
export const CurrentCheckout = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CheckoutCaller => {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const principal = request[PRINCIPAL_REQUEST_KEY] as Principal;
    const checkout = principal.checkout!;
    return {
      organizationId: principal.organizationId!,
      publishableKeyId: checkout.publishableKeyId,
      allowedOrigins: checkout.allowedOrigins,
      origin: checkout.origin,
    };
  },
);
