import { Prisma } from '../../../generated/prisma/client.js';
import type { ReadScope } from '../../domain/value-objects/organization-scope.js';

/**
 * The `where` fragment that limits a Prisma query to the scope's
 * Organization; empty for `all`. Spread it into every `where`.
 */
export function scopeWhere(scope: ReadScope): { organizationId?: string } {
  return scope.kind === 'organization'
    ? { organizationId: scope.organizationId }
    : {};
}

/** The SQL condition for a raw query: `column = <organization>`, or TRUE. */
export function scopeSql(scope: ReadScope, column: string): Prisma.Sql {
  return scope.kind === 'organization'
    ? Prisma.sql`${Prisma.raw(column)} = ${scope.organizationId}::uuid`
    : Prisma.sql`TRUE`;
}
