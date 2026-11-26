import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveCredentialKeys } from '../src/config/env.schema.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ReencryptGatewayCredentials } from '../src/payment-core/application/use-cases/manage-gateway-connections.js';
import { ALL_ORGANIZATIONS } from '../src/payment-core/domain/value-objects/organization-scope.js';
import { AesCredentialCipher } from '../src/payment-core/infrastructure/crypto/credential-cipher.js';
import { PrismaTransactionRunner } from '../src/payment-core/infrastructure/prisma/transaction-runner.js';

// `pnpm gateway:reencrypt`
// Key rotation: put the new key FIRST in GATEWAY_CREDENTIAL_KEYS (keep the old
// ones after it), then run this to re-encrypt every Gateway Connection under
// the first (primary) key. Safe to re-run. Same env-file precedence as the app.

const nodeEnv = process.env.NODE_ENV ?? 'development';
config({
  path: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
  quiet: true,
});

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const cipher = AesCredentialCipher.fromConfig(
    resolveCredentialKeys({
      GATEWAY_CREDENTIAL_KEYS: process.env.GATEWAY_CREDENTIAL_KEYS || undefined,
    }),
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const rewritten = await new ReencryptGatewayCredentials(
      new PrismaTransactionRunner(prisma),
      cipher,
    ).execute(ALL_ORGANIZATIONS);
    console.log(
      `Re-encrypted ${rewritten} Gateway Connection(s) under key "${cipher.primaryKeyId}".`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
