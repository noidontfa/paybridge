/**
 * Static checks over `prisma/schema.prisma` and the migration SQL, used by
 * `schema.spec.ts` (ADR 0001: table-prefix ownership; spec: partial indexes).
 */

/** Table-name prefixes that identify an owning module: Payment Core and Identity. */
export const OWNER_PREFIXES = ['core_', 'iam_'] as const;

export interface RequiredIndex {
  name: string;
  table: string;
  unique: boolean;
  /** The WHERE predicate exactly as Prisma emits it into the migration. */
  where: string;
}

/** Partial indexes the spec requires the database to enforce. */
export const REQUIRED_INDEXES: readonly RequiredIndex[] = [
  {
    // Invariant 6a: at most one open attempt per Payment.
    name: 'core_payment_transactions_one_open_uq',
    table: 'core_payment_transactions',
    unique: true,
    where:
      "status = ANY (ARRAY['CREATED'::core_payment_transaction_status, 'PENDING'::core_payment_transaction_status])",
  },
  {
    // Invariant 7: at most one SUCCEEDED attempt per Payment.
    name: 'core_payment_transactions_one_succeeded_uq',
    table: 'core_payment_transactions',
    unique: true,
    where: `"status" = 'SUCCEEDED'`,
  },
  {
    name: 'core_payments_pending_expiry_idx',
    table: 'core_payments',
    unique: false,
    where: `"status" = 'PENDING'`,
  },
  {
    name: 'core_outbox_events_unpublished_idx',
    table: 'core_outbox_events',
    unique: false,
    where: 'published_at IS NULL',
  },
  {
    name: 'core_webhook_inbox_processing_locked_idx',
    table: 'core_webhook_inbox',
    unique: false,
    where: `"status" = 'PROCESSING'`,
  },
  {
    name: 'core_webhook_inbox_pending_received_idx',
    table: 'core_webhook_inbox',
    unique: false,
    where:
      "status = ANY (ARRAY['RECEIVED'::core_webhook_inbox_status, 'FAILED'::core_webhook_inbox_status])",
  },
];

interface ModelBlock {
  name: string;
  body: string;
}

function modelBlocks(schema: string): ModelBlock[] {
  return [...schema.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)].map(
    (m) => ({ name: m[1], body: m[2] }),
  );
}

function mappedTable(body: string): string | undefined {
  return /@@map\(\s*(?:name:\s*)?"([^"]+)"\s*\)/.exec(body)?.[1];
}

/** Table names of every model, in schema order (unmapped models omitted). */
export function listModelTables(schema: string): string[] {
  return modelBlocks(schema)
    .map((model) => mappedTable(model.body))
    .filter((table): table is string => table !== undefined);
}

/** Models with no `@@map`, or mapped to a table without an owner prefix. */
export function findUnownedModels(
  schema: string,
  prefixes: readonly string[],
): string[] {
  return modelBlocks(schema)
    .filter((model) => {
      const table = mappedTable(model.body);
      return !table || !prefixes.some((prefix) => table.startsWith(prefix));
    })
    .map((model) => model.name);
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Required partial indexes not created, with their predicate, by the SQL. */
export function findMissingIndexes(
  sql: string,
  required: readonly RequiredIndex[],
): string[] {
  const statements = sql.replace(/--.*$/gm, '').split(';').map(normalize);
  return required
    .filter((index) => {
      const head = `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX "${index.name}" ON "${index.table}"`;
      return !statements.some(
        (statement) =>
          statement.startsWith(head) &&
          statement.endsWith(`WHERE (${normalize(index.where)})`),
      );
    })
    .map((index) => index.name);
}
