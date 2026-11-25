/** The signed-in User behind an operator request, from a verified access token. */
export interface PrincipalUser {
  readonly id: string;
  /** The Role the User held when the token was issued. */
  readonly role: string;
  readonly permissions: readonly string[];
  /** The User's name, set once a sensitive write has re-read them. */
  readonly name?: string;
}

/**
 * The authenticated caller, as Payment Core sees it (ADR 0006). Core never
 * reads identity tables: it receives this, and takes the Organization scope
 * of every query from it, never from a request body or query parameter.
 */
export interface Principal {
  /**
   * The Organization the caller works in. For a Super Admin: the one they
   * chose, or null when they chose none or "all Organizations".
   */
  readonly organizationId: string | null;
  /** A Super Admin reading across every Organization. Reads only. */
  readonly allOrganizations?: boolean;
  /** Set on operator requests (a User); null on the public payments API. */
  readonly user: PrincipalUser | null;
}

/** The request property the identity module's guard sets. */
export const PRINCIPAL_REQUEST_KEY = 'principal';

/** The header a Super Admin's chosen Organization (or `all`) travels in. */
export const ORGANIZATION_HEADER = 'x-organization-id';
