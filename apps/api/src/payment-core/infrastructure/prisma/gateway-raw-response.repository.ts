import { newId } from '../../domain/ids.js';
import type {
  GatewayRawResponse,
  NewGatewayRawResponse,
} from '../../domain/records.js';
import type {
  OrganizationScope,
  ReadScope,
} from '../../domain/organization-scope.js';
import type { GatewayRawResponseRepository } from '../../domain/repositories.js';
import type { DbContext } from './db.js';
import { scopeWhere } from './scope.js';

/** Raw provider payloads, stored for audit and never interpreted. */
export class PrismaGatewayRawResponseRepository implements GatewayRawResponseRepository {
  constructor(private readonly ctx: DbContext) {}

  async record(
    scope: OrganizationScope,
    response: NewGatewayRawResponse,
  ): Promise<GatewayRawResponse> {
    return this.ctx.db.gatewayRawResponse.create({
      data: {
        id: newId(),
        organizationId: scope.organizationId,
        attemptId: response.attemptId,
        operation: response.operation,
        payload: (response.payload ?? {}) as object,
      },
    });
  }

  /** Every stored response of one attempt, oldest first. */
  async listForAttempt(
    scope: ReadScope,
    attemptId: string,
  ): Promise<GatewayRawResponse[]> {
    return this.ctx.db.gatewayRawResponse.findMany({
      where: { ...scopeWhere(scope), attemptId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
