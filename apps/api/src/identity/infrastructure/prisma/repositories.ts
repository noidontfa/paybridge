import type { DbContext } from './db.js';
import { PrismaOrganizationRepository } from './organization.repository.js';

/** Every identity repository, bound to one database handle. */
export interface Repositories {
  readonly organizations: PrismaOrganizationRepository;
}

export function createRepositories(ctx: DbContext): Repositories {
  return { organizations: new PrismaOrganizationRepository(ctx) };
}
