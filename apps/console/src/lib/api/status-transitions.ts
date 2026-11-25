/**
 * `GET /internal/status-transitions`: the audit log. Each row carries the
 * `paymentId` it belongs to (a PaymentTransaction resolves to its Payment,
 * a Refund has none yet), so the Console never needs a second lookup to link.
 */
import { z } from 'zod';
import { request } from './client';
import { listPageSchema, type ListPage, type ListQuery } from './pagination';
import { statusTransitionSchema, type StatusTransitionEntityType } from './schemas';

export const auditEntrySchema = statusTransitionSchema.extend({ paymentId: z.string().nullable() });
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListSchema = listPageSchema(auditEntrySchema);
export type AuditList = ListPage<AuditEntry>;

export interface AuditListQuery extends ListQuery {
  entityType?: StatusTransitionEntityType;
  entityId?: string;
  trigger?: string;
  actor?: string;
}

export function listStatusTransitions(query: AuditListQuery, signal?: AbortSignal): Promise<AuditList> {
  return request('/internal/status-transitions', auditListSchema, { query: { ...query }, signal });
}
