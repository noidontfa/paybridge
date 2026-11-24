/**
 * Injection token for the list of Gateway Plugins (`PaymentGateway[]`). The
 * composition root provides it; Core only consumes it.
 */
export const GATEWAY_PLUGINS = Symbol('GATEWAY_PLUGINS');
