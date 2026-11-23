Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: none

# Table ownership convention on the shared public schema

## Question

PayBridge uses one shared PostgreSQL `public` schema, and table ownership must still be clear. Decide:

1. How ownership is expressed: table name prefix (for example `core_payments`), Prisma model grouping within one `schema.prisma`, a documented ownership table, or a lint or test check. Pick one, or a combination, and say why.
2. Which module may write each table, and which may only read it. Gateway plugins must never write Core tables.
3. Whether gateway plugins own any tables at all, and if so, under which prefix.
4. Whether the convention must be recorded as an ADR (apply the three-part test in `domain-modeling`).

## Answer

<!-- filled in on resolution -->
