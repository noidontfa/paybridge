import { newId } from '../../domain/ids.js';
import type {
  NewStatusTransition,
  StatusTransition,
  StatusTransitionEntityType,
} from '../../domain/records.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../domain/organization-scope.js';
import type { DbContext } from './db.js';
import { scopeWhere } from './scope.js';

/**
 * Append-only audit trail of status changes. Write it with the runner's
 * transaction-bound repositories so it commits or rolls back with the change.
 */
export class PrismaStatusTransitionRepository {
  constructor(private readonly ctx: DbContext) {}

  async record(
    scope: OrganizationScope,
    transition: NewStatusTransition,
  ): Promise<StatusTransition> {
    return this.ctx.db.statusTransition.create({
      data: {
        id: newId(),
        organizationId: scope.organizationId,
        entityType: transition.entityType,
        entityId: transition.entityId,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        trigger: transition.trigger,
        actor: transition.actor,
        reason: transition.reason ?? null,
      },
    });
  }

  /** The trail of one entity, oldest first. */
  async listForEntity(
    scope: ReadScope,
    entityType: StatusTransitionEntityType,
    entityId: string,
  ): Promise<StatusTransition[]> {
    return this.ctx.db.statusTransition.findMany({
      where: { ...scopeWhere(scope), entityType, entityId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
