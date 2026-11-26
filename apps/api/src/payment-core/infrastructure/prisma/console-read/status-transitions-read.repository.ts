import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service.js';
import { Prisma } from '../../../../generated/prisma/client.js';
import { escapeLike, uuidNeedle } from './read-helpers.js';
import type { ReadScope } from '../../../domain/organization-scope.js';
import type { StatusTransitionEntityType as TransitionEntityType } from '../../../domain/records.js';
import { scopeSql } from '../scope.js';
import {
  StatusTransitionsReadRepository,
  type StatusTransitionListQuery,
  type StatusTransitionRow,
} from '../../../domain/console-read/status-transitions-read.repository.js';

interface RawRow {
  id: string;
  entity_type: TransitionEntityType;
  entity_id: string;
  from_status: string | null;
  to_status: string;
  trigger: string;
  actor: string;
  actor_role: string | null;
  actor_name: string | null;
  reason: string | null;
  created_at: Date;
  payment_id: string | null;
}

/**
 * Read model behind the operator audit log (`core_status_transitions`). The
 * trail has no foreign keys, so each row is joined to the Payment it belongs
 * to; the join is also what lets the search match an Upstream Reference.
 */
@Injectable()
export class PrismaStatusTransitionsReadRepository implements StatusTransitionsReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Up to `limit + 1` rows, newest first. */
  async list(
    scope: ReadScope,
    query: StatusTransitionListQuery,
  ): Promise<StatusTransitionRow[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT st.id, st.entity_type, st.entity_id, st.from_status, st.to_status,
             st.trigger, st.actor, st.actor_role, st.actor_name, st.reason, st.created_at, p.id AS payment_id
      FROM core_status_transitions st
      LEFT JOIN core_payment_transactions pt
        ON st.entity_type = 'PAYMENT_TRANSACTION' AND pt.id = st.entity_id
      LEFT JOIN core_payments p
        ON p.id = CASE st.entity_type
                    WHEN 'PAYMENT' THEN st.entity_id
                    WHEN 'PAYMENT_TRANSACTION' THEN pt.payment_id
                  END
      ${this.where(scope, query)}
      ORDER BY st.created_at DESC, st.id DESC
      LIMIT ${query.limit + 1}`;
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      trigger: row.trigger,
      actor: row.actor,
      actorRole: row.actor_role,
      actorName: row.actor_name,
      reason: row.reason,
      createdAt: row.created_at,
      paymentId: row.payment_id,
    }));
  }

  private where(
    scope: ReadScope,
    query: StatusTransitionListQuery,
  ): Prisma.Sql {
    const { filters, after } = query;
    const conditions: Prisma.Sql[] = [scopeSql(scope, 'st.organization_id')];
    if (filters.entityType) {
      conditions.push(
        Prisma.sql`st.entity_type = ${filters.entityType}::core_status_transition_entity_type`,
      );
    }
    if (filters.entityId) {
      conditions.push(Prisma.sql`st.entity_id = ${filters.entityId}::uuid`);
    }
    if (filters.trigger) {
      conditions.push(Prisma.sql`st.trigger = ${filters.trigger}`);
    }
    if (filters.actor) conditions.push(Prisma.sql`st.actor = ${filters.actor}`);
    if (filters.q) {
      const id = uuidNeedle(filters.q);
      const pattern = `%${escapeLike(filters.q)}%`;
      conditions.push(
        id
          ? Prisma.sql`(st.entity_id = ${id}::uuid OR p.id = ${id}::uuid OR p.merchant_order_id ILIKE ${pattern})`
          : Prisma.sql`p.merchant_order_id ILIKE ${pattern}`,
      );
    }
    if (after) {
      conditions.push(
        Prisma.sql`(st.created_at, st.id) < (${new Date(after.value)}::timestamptz, ${after.id}::uuid)`,
      );
    }
    return conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }
}
