import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  resolveCredentialKeys,
  resolveStripeConfig,
} from '../src/config/env.schema.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ImportEnvStripeAccount } from '../src/payment-core/application/use-cases/import-env-stripe-account.js';
import { CredentialCipher } from '../src/payment-core/infrastructure/crypto/credential-cipher.js';
import { PrismaTransactionRunner } from '../src/payment-core/infrastructure/prisma/transaction-runner.js';

// `pnpm gateway:import-stripe`
// One-off migration: copies the STRIPE_* account from the environment into the
// default Organization's Stripe Gateway Connection. Safe to re-run: it never
// replaces an existing connection. Then point the Stripe dashboard at the
// connection's Callback URL (shown in the Console's Gateways view) and remove
// the STRIPE_* variables.

const nodeEnv = process.env.NODE_ENV ?? 'development';
config({
  path: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
  quiet: true,
});

const MESSAGES = {
  created: 'Copied the env Stripe account into the default Organization.',
  exists:
    'The default Organization already has a Stripe connection; nothing changed.',
  'not-configured': 'The STRIPE_* variables are not all set; nothing to copy.',
} as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const cipher = CredentialCipher.fromConfig(
    resolveCredentialKeys({
      GATEWAY_CREDENTIAL_KEYS: process.env.GATEWAY_CREDENTIAL_KEYS || undefined,
    }),
  );
  const stripe = resolveStripeConfig({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || undefined,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || undefined,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const result = await new ImportEnvStripeAccount(
      new PrismaTransactionRunner(prisma),
      cipher,
    ).execute(stripe);
    console.log(MESSAGES[result]);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
