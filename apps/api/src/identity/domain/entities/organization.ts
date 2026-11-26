/** An Organization is either active or suspended; it is never deleted. */
export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/**
 * The unit of isolation in PayBridge: every Payment and everything under it belongs to
 * exactly one Organization (ADR 0006).
 */
export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewOrganization {
  readonly id: string;
  readonly name: string;
}

/**
 * The Organization the migration creates and backfills all existing data
 * into. Until sign-in exists (ticket 04), the stub principal scopes every
 * request to it.
 */
export const DEFAULT_ORGANIZATION_ID = '00000000-0000-7000-8000-000000000001';

export class OrganizationNotFoundError extends Error {
  constructor(readonly organizationId: string) {
    super(`Organization ${organizationId} not found`);
    this.name = 'OrganizationNotFoundError';
  }
}
