// The PaymentGateway port: the only contract between Core and Gateway Plugins.
// Exports port types and error categories only, never a plugin.
export * from './gateway-errors.js';
export type * from './next-action.js';
export * from './normalized-outcome.js';
export type * from './payment-gateway.port.js';
