/**
 * Injection token for the list of Gateway Plugin registrations
 * (`GatewayRegistration[]`: a factory plus its credentials). The composition
 * root provides it; Core only consumes it.
 */
export const GATEWAY_PLUGINS = Symbol('GATEWAY_PLUGINS');
