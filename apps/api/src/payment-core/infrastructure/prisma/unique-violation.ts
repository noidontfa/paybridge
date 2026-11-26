import { Prisma } from '../../../generated/prisma/client.js';
import { UniqueViolationError } from '../../domain/repositories/repositories.js';

/**
 * True when `error` is a unique-constraint violation (Prisma `P2002`). Internal
 * to the Prisma repositories: use cases see `UniqueViolationError` instead.
 */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Awaits a write and turns a unique-constraint violation into the domain's
 * `UniqueViolationError`, keeping the Prisma error as its `cause`. Wrap only
 * the writes that can lose an insert race.
 */
export async function rethrowUniqueViolation<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw new UniqueViolationError('Unique constraint violated', {
        cause: error,
      });
    }
    throw error;
  }
}
