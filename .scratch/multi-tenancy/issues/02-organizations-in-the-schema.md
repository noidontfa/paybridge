# 02: Organizations in the schema (tracer bullet)

**What to build:** Every Payment and everything under it belongs to exactly one Organization, and nothing in one Organization is visible from another. This creates the `identity` module (with its `iam_` prefix and Organizations table), backfills existing data into a default Organization, and makes every Payment Core repository take an explicit Organization scope (ADR 0006). There is no sign-in yet, so a temporary stub principal scopes everything to the default Organization until ticket 04 replaces it. See the [spec](../spec.md) and the [map](../map.md).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A new `identity` module owns the `iam_` prefix, laid out like Payment Core (domain, application use-cases, ports, infrastructure, HTTP), with the same boundary specs (database client only in its Prisma adapter, one transaction runner); the table-prefix ownership spec knows the new prefix
- [ ] Organizations have a name, an active or suspended state and timestamps; there is no delete
- [ ] Every `core_*` table holding Organization data (Payments, PaymentTransactions, Refunds, idempotency keys, Payment Events, Callbacks, status transitions) has a non-null `organization_id` foreign key to Organizations
- [ ] One migration creates the default Organization, backfills every existing row, then sets the column non-null; it runs cleanly on a database that already has data
- [ ] The Upstream Reference is unique per Organization: two Organizations can use the same Upstream Reference, one Organization cannot reuse its own
- [ ] Every Payment Core repository method touching Organization data takes an explicit Organization scope; operator read models accept "all Organizations" only as an explicit option
- [ ] A static isolation spec fails when a repository method touching Organization data has no Organization scope
- [ ] Operator list indexes lead with the Organization where the query filters by it
- [ ] The public payments API and `/internal` routes run with a temporary stub principal scoped to the default Organization; the scope never comes from a body or query parameter
- [ ] The seed creates its scenarios inside at least two Organizations
- [ ] Integration tests over HTTP show that a Payment, Review, Callback, Payment Event or audit row of one Organization is not-found and never listed when scoped to another
