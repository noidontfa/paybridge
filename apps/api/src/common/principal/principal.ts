/**
 * The authenticated caller, as Payment Core sees it (ADR 0006). Core never
 * reads identity tables: it receives this, and takes the Organization scope
 * of every query from it, never from a request body or query parameter.
 */
export interface Principal {
  /** The Organization the caller works in. */
  readonly organizationId: string;
}

/** The request property the identity module's guard sets. */
export const PRINCIPAL_REQUEST_KEY = 'principal';
