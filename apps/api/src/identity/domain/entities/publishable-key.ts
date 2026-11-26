/**
 * Who made a change to a credential: kept on the row so the Console can show
 * it. A Super Admin is shown as the platform.
 */
export interface KeyWriter {
  readonly userId: string;
  readonly role: string;
  readonly name: string | null;
}

/**
 * An Organization's public key for Customers' browsers (ADR 0009). It works
 * only on the checkout endpoints and only from its allowed origins. It is not
 * secret, so it is stored in clear and can be shown again at any time.
 */
export interface PublishableKey {
  readonly id: string;
  readonly organizationId: string;
  readonly label: string;
  readonly key: string;
  /** Normalised origins (`https://shop.example.com:8443`), at least one. */
  readonly allowedOrigins: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly revokedAt: Date | null;
  readonly createdBy: KeyWriter | null;
  readonly updatedBy: KeyWriter | null;
}

export type NewPublishableKey = Pick<
  PublishableKey,
  'id' | 'organizationId' | 'label' | 'key' | 'allowedOrigins' | 'createdBy'
> & { readonly createdAt: Date };

export const PUBLISHABLE_KEY_LABEL_MAX = 100;
export const ALLOWED_ORIGINS_MAX = 20;
const ORIGIN_LENGTH_MAX = 200;

export class InvalidPublishableKeyLabelError extends Error {
  constructor() {
    super(
      `A Publishable Key needs a label of 1 to ${PUBLISHABLE_KEY_LABEL_MAX} characters`,
    );
    this.name = 'InvalidPublishableKeyLabelError';
  }
}

export class InvalidAllowedOriginsError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidAllowedOriginsError';
  }
}

export class PublishableKeyNotFoundError extends Error {
  constructor(readonly publishableKeyId: string) {
    super(`Publishable Key ${publishableKeyId} not found`);
    this.name = 'PublishableKeyNotFoundError';
  }
}

export class PublishableKeyRevokedError extends Error {
  constructor(readonly publishableKeyId: string) {
    super(`Publishable Key ${publishableKeyId} is revoked`);
    this.name = 'PublishableKeyRevokedError';
  }
}

/** The key is unknown, revoked, or its Organization is suspended. */
export class InvalidPublishableKeyError extends Error {
  /**
   * For the developer console only (checkout endpoints show it as the
   * "unavailable" reason); the caller is refused the same way either way.
   */
  constructor(
    readonly reason:
      | 'INVALID_PUBLISHABLE_KEY'
      | 'ORGANIZATION_SUSPENDED' = 'INVALID_PUBLISHABLE_KEY',
  ) {
    super('A valid Publishable Key is required');
    this.name = 'InvalidPublishableKeyError';
  }
}

/** The request's `Origin` is missing or not one of the key's allowed origins. */
export class OriginNotAllowedError extends Error {
  constructor() {
    super('This website is not allowed to use this Publishable Key');
    this.name = 'OriginNotAllowedError';
  }
}

export function normalisePublishableKeyLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > PUBLISHABLE_KEY_LABEL_MAX) {
    throw new InvalidPublishableKeyLabelError();
  }
  return trimmed;
}

/** Hosts that only exist on the developer's own machine. */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

/**
 * The origin (scheme, host and port) a value names, or null when it is not
 * exactly an origin: a path, query, fragment, credentials or wildcard make it
 * something else. The default port is dropped (`https://a.com:443` is
 * `https://a.com`).
 */
export function parseOrigin(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ORIGIN_LENGTH_MAX || trimmed.includes('*')) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const exact =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !trimmed.endsWith('?') &&
    !trimmed.endsWith('#');
  return exact ? url : null;
}

/**
 * Validates and normalises a key's allowed origins: at least one, each an
 * origin, HTTPS except on a local host, and local hosts only when
 * `allowLocalhost` (outside production). Duplicates collapse, order is kept.
 */
export function normaliseAllowedOrigins(
  values: readonly string[],
  rules: { readonly allowLocalhost: boolean },
): string[] {
  if (values.length === 0) {
    throw new InvalidAllowedOriginsError(
      'A Publishable Key needs at least one allowed origin',
    );
  }
  const origins: string[] = [];
  for (const value of values) {
    const url = parseOrigin(value);
    if (!url) {
      throw new InvalidAllowedOriginsError(
        `"${value}" is not an origin (scheme, host and optional port)`,
      );
    }
    const local = isLocalHost(url.hostname);
    if (local && !rules.allowLocalhost) {
      throw new InvalidAllowedOriginsError(
        `"${value}" is a local origin, which is allowed only outside production`,
      );
    }
    if (!local && url.protocol !== 'https:') {
      throw new InvalidAllowedOriginsError(`"${value}" must use https`);
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  if (origins.length > ALLOWED_ORIGINS_MAX) {
    throw new InvalidAllowedOriginsError(
      `A Publishable Key allows at most ${ALLOWED_ORIGINS_MAX} origins`,
    );
  }
  return origins;
}

/** Whether a request's `Origin` header is one of the key's allowed origins. */
export function isOriginAllowed(
  key: Pick<PublishableKey, 'allowedOrigins'>,
  origin: string | undefined,
): boolean {
  if (!origin) return false;
  const url = parseOrigin(origin);
  return url !== null && key.allowedOrigins.includes(url.origin);
}
