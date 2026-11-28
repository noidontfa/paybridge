# Share one PostgreSQL public schema, with table-prefix ownership

PayBridge keeps all tables in the single shared `public` schema instead of one Postgres schema per module, because the single shared schema is a fixed constraint of Phase 1. Ownership is expressed by a `core_` table-name prefix set through Prisma's `@@map`, and a Vitest spec over `schema.prisma` enforces it. Payment Core is the only owner in Phase 1: gateway plugins own no tables and hand raw provider payloads to Core through the port, and Core is the sole writer of its tables.

> Superseded in part by [ADR 0010](0010-modules-own-their-tables-by-prefix.md): Payment Core is no longer the only owner. Every module owns and solely writes the tables with its own prefix (`core_`, `iam_`, `chk_`, `wh_`). The shared `public` schema and prefix ownership stand.
