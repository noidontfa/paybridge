// The identity module's public surface: the only identity code other modules
// (Payment Core, common/) may import. Anything not exported here is internal
// to identity. `.oxlintrc.json` fails `pnpm lint` when Payment Core imports
// identity from anywhere else.
export { DEFAULT_ORGANIZATION_ID } from '../domain/entities/organization.js';
export type { Permission } from '../domain/permissions.js';
export { Public } from '../infrastructure/http/principal.guard.js';
export {
  CheckoutEndpoint,
  CurrentCheckout,
} from '../infrastructure/http/checkout-endpoint.js';
export type { CheckoutCaller } from '../application/use-cases/publishable-keys.js';
