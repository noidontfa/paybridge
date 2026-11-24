import { newId } from '../../domain/ids.js';
import type {
  GatewayRawResponse,
  NewGatewayRawResponse,
} from '../../domain/records.js';
import type { DbContext } from './db.js';

/** Raw provider payloads, stored for audit and never interpreted. */
export class PrismaGatewayRawResponseRepository {
  constructor(private readonly ctx: DbContext) {}

  async record(response: NewGatewayRawResponse): Promise<GatewayRawResponse> {
    return this.ctx.db.gatewayRawResponse.create({
      data: {
        id: newId(),
        attemptId: response.attemptId,
        operation: response.operation,
        payload: (response.payload ?? {}) as object,
      },
    });
  }

  /** Every stored response of one attempt, oldest first. */
  async listForAttempt(attemptId: string): Promise<GatewayRawResponse[]> {
    return this.ctx.db.gatewayRawResponse.findMany({
      where: { attemptId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
