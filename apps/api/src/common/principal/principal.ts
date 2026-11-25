/** The signed-in User behind an operator request, from a verified access token. */
export interface PrincipalUser {
  readonly id: string;
  /** The Role the User held when the token was issued. */
  readonly role: string;
  readonly permissions: readonly string[];
}

/**
 * The authenticated caller, as Payment Core sees it (ADR 0006). Core never
 * reads identity tables: it receives this, and takes the Organization scope
 * of every query from it, never from a request body or query parameter.
 */
export interface Principal {
  /** The Organization the caller works in. Null for a Super Admin. */
  readonly organizationId: string | null;
  /** Set on operator requests (a User); null on the public payments API. */
  readonly user: PrincipalUser | null;
}

/** The request property the identity module's guard sets. */
export const PRINCIPAL_REQUEST_KEY = 'principal';
