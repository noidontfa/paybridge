Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: none

# Table ownership convention on the shared public schema

## Question

PayBridge uses one shared PostgreSQL `public` schema, and table ownership must still be clear. Decide:

1. How ownership is expressed: table name prefix (for example `core_payments`), Prisma model grouping within one `schema.prisma`, a documented ownership table, or a lint or test check. Pick one, or a combination, and say why.
2. Which module may write each table, and which may only read it. Gateway plugins must never write Core tables.
3. Whether gateway plugins own any tables at all, and if so, under which prefix.
4. Whether the convention must be recorded as an ADR (apply the three-part test in `domain-modeling`).

## Answer

1. **Expression**: a combination of (a) a table-name prefix that names the owner, and (d) a check in CI. Each table's physical name is set with `@@map`, for example `@@map("core_payments")`. Prisma model names are free. Payment Core owns the prefix `core_`. A Vitest spec in `apps/api` parses `schema.prisma` and asserts that every model has a `@@map`, and that every `@@map` starts with a valid owner prefix. Model grouping and a separate ownership document were rejected: the first is invisible in the database, and the second drifts from the code.
2. **Read and write rights**:
   - Payment Core is the sole owner and sole writer of every `core_*` table, including the Transactional Outbox, Webhook Inbox and Idempotency tables.
   - Gateway plugins never read or write any Core table.
   - Core never reads a plugin's tables, because Core has no dependency on any plugin.
   - Within Core, only a table's own repository writes that table. Other modules call the repository and do not touch Prisma directly.
3. **Plugin-owned tables**: none in Phase 1. Gateway plugins are stateless adapters. A table that stores raw provider responses is shared across providers and is owned by Core, for example `core_gateway_raw_responses`. Core is its only writer. A plugin returns its raw payload through the explicit extension field of the `PaymentGateway` port (ticket 05), and Core persists it. Ticket 05 must include that extension field.
4. **ADR**: yes. See [ADR 0001: Shared public schema with table-prefix ownership](../../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md).
