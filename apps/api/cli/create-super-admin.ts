import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { CreateSuperAdmin } from '../src/identity/application/use-cases/create-super-admin.js';
import { EmailTakenError } from '../src/identity/domain/errors.js';
import { WeakPasswordError } from '../src/identity/domain/user.js';
import { Argon2PasswordHasher } from '../src/identity/infrastructure/crypto/argon2-password-hasher.js';
import { PrismaTransactionRunner } from '../src/identity/infrastructure/prisma/transaction-runner.js';
import { SystemIdentityClock } from '../src/identity/port/clock.js';

// `pnpm identity:create-super-admin --email you@example.com --name "Your Name"`
// The password comes from SUPER_ADMIN_PASSWORD (preferred: it stays out of the
// shell history) or `--password`. Works at any time, also when Super Admins
// already exist. For an email that already belongs to a Super Admin it
// recovers the account: new password, active again, signed out everywhere.
// Same env-file precedence as the Nest app and prisma.config.ts.

const nodeEnv = process.env.NODE_ENV ?? 'development';
config({
  path: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
  quiet: true,
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string', default: '' },
      password: { type: 'string' },
    },
  });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const password = values.password ?? process.env.SUPER_ADMIN_PASSWORD;
  if (!values.email || !password) {
    throw new Error(
      'Usage: --email <email> [--name <name>] with the password in SUPER_ADMIN_PASSWORD (or --password).',
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const create = new CreateSuperAdmin(
      new PrismaTransactionRunner(prisma),
      new Argon2PasswordHasher(),
      new SystemIdentityClock(),
    );
    const { user, recovered } = await create.execute({
      email: values.email,
      name: values.name,
      password,
    });
    console.log(
      `${recovered ? 'Recovered' : 'Created'} Super Admin ${user.email} (${user.id}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const known =
    error instanceof WeakPasswordError ||
    error instanceof EmailTakenError ||
    (error instanceof Error && error.message.startsWith('Usage:')) ||
    (error instanceof Error && error.message.startsWith('DATABASE_URL'));
  console.error(known ? `Refused: ${(error as Error).message}` : error);
  process.exit(1);
});
