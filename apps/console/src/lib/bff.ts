/**
 * The Console's own API prefix (the BFF, ADR 0004). The browser only ever calls
 * `BFF_PREFIX + <API path>`; the Route Handler forwards it to the API base URL
 * with the same path, method, query and body. Safe to import anywhere.
 */
export const BFF_PREFIX = '/api/bff';
