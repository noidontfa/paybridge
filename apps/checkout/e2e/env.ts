import { createHash } from 'node:crypto';

// Where the Playwright run puts everything. Ports and the database are its
// own, so it never reuses another worktree's servers or data.

const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const API_PORT = port('E2E_API_PORT', 9290);
export const CHECKOUT_PORT = port('E2E_CHECKOUT_PORT', 3290);
/** The seed's Publishable Key allows exactly http://localhost:5173. */
export const ALLOWED_HOST_PORT = 5173;
export const DISALLOWED_HOST_PORT = port('E2E_DISALLOWED_HOST_PORT', 5174);

export const API_URL = `http://localhost:${API_PORT}`;
export const CHECKOUT_URL = `http://localhost:${CHECKOUT_PORT}`;
export const ALLOWED_HOST = `http://localhost:${ALLOWED_HOST_PORT}`;
/** Another origin, which the seed's key does not allow. */
export const DISALLOWED_HOST = `http://127.0.0.1:${DISALLOWED_HOST_PORT}`;

export const DATABASE_NAME = process.env.E2E_DATABASE_NAME ?? 'paybridge_e2e_checkout';
const DATABASE_SERVER =
  process.env.E2E_DATABASE_SERVER ?? 'postgresql://paybridge:paybridge@localhost:5432';
export const DATABASE_URL = `${DATABASE_SERVER}/${DATABASE_NAME}?schema=public`;

// Fixed seed data (apps/api/seed): ids are UUID v5 of a name in the seed's namespace.
const SEED_NAMESPACE = 'c3a1e0a0-5eed-4b1d-9c5e-0d5eed5eed01';

function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const SEED = {
  publishableKey: 'pb_pk_seed_default_000000000000000000000000',
  pricingTableId: uuidV5('pricing-table:primary-home', SEED_NAMESPACE),
  plans: {
    basic: uuidV5('pricing-plan:primary-basic', SEED_NAMESPACE),
    pro: uuidV5('pricing-plan:primary-pro', SEED_NAMESPACE),
    legacy: uuidV5('pricing-plan:primary-legacy', SEED_NAMESPACE),
  },
  /** HMAC secret of the fake gateways' callbacks. */
  fakeSecret: 'fake-secret',
} as const;
