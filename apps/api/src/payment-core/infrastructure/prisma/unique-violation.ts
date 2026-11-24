import { Prisma } from '../../../generated/prisma/client.js';

/**
 * True when `error` is a unique-constraint violation (Prisma `P2002`), so a
 * use case can tell "someone else inserted this first" from a real failure
 * without importing Prisma. The transaction it happened in is already rolled
 * back; recover outside it.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
