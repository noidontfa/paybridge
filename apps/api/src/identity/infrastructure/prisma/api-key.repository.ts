import type { ApiKey, NewApiKey } from '../../domain/api-key.js';
import { ApiKeyRepository } from '../../port/api-key.repository.js';
import type { DbContext } from './db.js';

/** API Keys in `iam_api_keys`, by hash only. */
export class PrismaApiKeyRepository extends ApiKeyRepository {
  constructor(private readonly ctx: DbContext) {
    super();
  }

  create(key: NewApiKey): Promise<ApiKey> {
    return this.ctx.db.apiKey.create({ data: key });
  }

  findByHash(keyHash: string): Promise<ApiKey | null> {
    return this.ctx.db.apiKey.findUnique({ where: { keyHash } });
  }

  listOfOrganization(organizationId: string): Promise<ApiKey[]> {
    return this.ctx.db.apiKey.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async revoke(organizationId: string, id: string, at: Date): Promise<boolean> {
    const found = await this.ctx.db.apiKey.findFirst({
      where: { id, organizationId },
    });
    if (!found) return false;
    await this.ctx.db.apiKey.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: at },
    });
    return true;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.ctx.db.apiKey.update({ where: { id }, data: { lastUsedAt: at } });
  }
}
