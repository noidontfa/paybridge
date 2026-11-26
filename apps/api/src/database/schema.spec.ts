import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findMissingIndexes,
  findUnownedModels,
  listModelTables,
  OWNER_PREFIXES,
  REQUIRED_INDEXES,
} from './schema-guard.js';

// ADR 0001: every table lives in `public` and is owned through a table-name
// prefix. The spec (PostgreSQL schema) requires the partial indexes below.

const prismaDir = join(import.meta.dirname, '../../prisma');
const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
const migrationsSql = readdirSync(join(prismaDir, 'migrations'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    readFileSync(
      join(prismaDir, 'migrations', entry.name, 'migration.sql'),
      'utf8',
    ),
  )
  .join('\n');

describe('schema ownership', () => {
  it('maps every model to a table with an owner prefix', () => {
    expect(findUnownedModels(schema, OWNER_PREFIXES)).toEqual([]);
  });

  it('reports a model without a table mapping', () => {
    const text = `
      model Payment {
        id String @id
        @@map("core_payments")
      }
      model Stray {
        id String @id
      }`;
    expect(findUnownedModels(text, OWNER_PREFIXES)).toEqual(['Stray']);
  });

  it('reports a model mapped to a table without an owner prefix', () => {
    const text = `
      model Ledger {
        id String @id
        @@map("ledger_entries")
      }`;
    expect(findUnownedModels(text, OWNER_PREFIXES)).toEqual(['Ledger']);
  });

  it('declares the Payment Core tables and the identity tables', () => {
    expect(listModelTables(schema).sort()).toEqual([
      'core_gateway_connections',
      'core_gateway_raw_responses',
      'core_idempotency_keys',
      'core_outbox_events',
      'core_payment_transactions',
      'core_payments',
      'core_refunds',
      'core_status_transitions',
      'core_webhook_inbox',
      'iam_api_keys',
      'iam_organizations',
      'iam_password_resets',
      'iam_refresh_tokens',
      'iam_users',
    ]);
  });
});

describe('schema partial indexes', () => {
  it('creates every required partial index in the migrations', () => {
    expect(findMissingIndexes(migrationsSql, REQUIRED_INDEXES)).toEqual([]);
  });

  it('reports a partial index that is missing', () => {
    const sql = REQUIRED_INDEXES.filter((_, i) => i > 0)
      .map(
        (index) =>
          `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX "${index.name}" ON "${index.table}"("x") WHERE (${index.where});`,
      )
      .join('\n');
    expect(findMissingIndexes(sql, REQUIRED_INDEXES)).toEqual([
      REQUIRED_INDEXES[0].name,
    ]);
  });

  it('reports a required index created without its WHERE clause', () => {
    const [first] = REQUIRED_INDEXES;
    const sql = `CREATE UNIQUE INDEX "${first.name}" ON "${first.table}"("payment_id");`;
    expect(findMissingIndexes(sql, [first])).toEqual([first.name]);
  });
});
