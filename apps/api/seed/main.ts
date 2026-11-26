import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { runSeed, SEED_PASSWORD, SeedRefusedError } from './seed.js';

// `pnpm db:seed [-- --bulk 500] [-- --force]` (runs through `prisma db seed`).
// Same env-file precedence as the Nest app and prisma.config.ts.

const nodeEnv = process.env.NODE_ENV ?? 'development';
config({
  path: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
  quiet: true,
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      bulk: { type: 'string' },
    },
  });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new SeedRefusedError('DATABASE_URL is not set.');
  const bulk = values.bulk === undefined ? 0 : Number(values.bulk);

  const result = await runSeed({
    databaseUrl,
    nodeEnv,
    force: values.force,
    bulk,
  });
  console.log(
    `Seeded ${result.users} Users (password: ${SEED_PASSWORD}) and ${result.payments} Payments in ${result.organizations} Organizations, ${result.attempts} PaymentTransactions, ${result.transitions} status transitions, ${result.callbacks} Callbacks and ${result.events} Payment Events.`,
  );
  console.log(`Seeded ${result.pricingPlans} Pricing Plans.`);
  for (const k of result.apiKeys) {
    console.log(`API Key (${k.label}${k.revoked ? ', revoked' : ''}): ${k.key}`);
  }
  console.log(
    `Webhook Endpoint: ${result.webhookEndpoint.url} (signing secret ${result.webhookEndpoint.secret}); receive with \`pnpm webhooks:receive\`.`,
  );
  for (const k of result.publishableKeys) {
    console.log(
      `Publishable Key (${k.label}, ${k.allowedOrigins.join(' ')}): ${k.key}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof SeedRefusedError ? `Refused: ${error.message}` : error,
  );
  process.exit(1);
});
