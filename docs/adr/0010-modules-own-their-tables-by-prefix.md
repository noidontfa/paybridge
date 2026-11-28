---
status: accepted
---

# Each module owns and solely writes its prefixed tables

ADR 0001 made Payment Core the only table owner, but Identity (`iam_`), the checkout module (`chk_`: Pricing Plans, Pricing Tables, checkout sessions) and the webhooks module (`wh_`: endpoints, deliveries, attempts) now keep data of their own. We decided that every module owns the tables with its prefix (`core_`, `iam_`, `chk_`, `wh_`), is the only one that writes them, and reaches another module's data only through that module's `port/`, never through its tables or internals. We kept one shared `public` schema with prefixes (ADR 0001's constraint) rather than giving each module its own Postgres schema, and we let modules hold plain id columns of another module's rows (a checkout Payment's Pricing Plan id in `core_payments`, a delivery's Payment id in `wh_deliveries`) without a foreign key across the boundary, so Payment Core stays independent of the modules built on it.

## Consequences

- `OWNER_PREFIXES` in `src/database/schema-guard.ts` lists the four prefixes, and a new module adds its own prefix there before it adds a table.
- Lint overrides and the architecture specs keep each module's imports to other modules' `port/` files; the isolation spec checks that every scoped repository method takes the Organization scope first (ADR 0006).
- The only foreign keys across prefixes point at `iam_organizations` (every Organization-owned table has one), because the Organization is the tenant boundary.
