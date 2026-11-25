// COPIED BY HAND from apps/console/src/lib/api/status-transitions.ts (client functions left out). Keep in sync: ADR 0004, ADR 0005.
// Do not edit this copy; change the Console file and copy again.
/**
 * `GET /internal/status-transitions`: the audit log. Each row carries the
 * `paymentId` it belongs to (a PaymentTransaction resolves to its Payment,
 * a Refund has none yet), so the Console never needs a second lookup to link.
 */
import { z } from 'zod';
import { listPageSchema, type ListPage, type ListQuery } from './pagination.js';
import { statusTransitionSchema, type StatusTransitionEntityType } from './schemas.js';

export const auditEntrySchema = statusTransitionSchema.extend({ paymentId: z.string().nullable() });
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListSchema = listPageSchema(auditEntrySchema);
export type AuditList = ListPage<AuditEntry>;

export interface AuditListQuery extends ListQuery {
  entityType?: StatusTransitionEntityType;
  entityId?: string;
  trigger?: string;
  actor?: string;
  /** Payment id, Upstream Reference or entity id (substring, case-insensitive). */
  q?: string;
}
