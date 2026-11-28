# 01: Mode in the scope and the schema

**What to build:** Every Mode-owned row has a Mode, every Organization scope names a Mode, and every repository filters by it, with all existing data and callers treated as Live. Nothing user-visible changes yet. See the [spec](../spec.md) (Mode in the scope, Schema, Background work) and [ADR 0011](../../../docs/adr/0011-mode-is-a-second-scope-inside-an-organization.md).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A `mode` column (`LIVE` / `TEST`, not null) on every Mode-owned table listed in the spec; one migration backfills every existing row as `LIVE`.
- [ ] Unique constraints that include `organization_id` also include `mode` (Upstream Reference, Gateway Connections, webhook inbox dedupe, idempotency keys).
- [ ] `OrganizationScope` carries a Mode; the `Principal` carries a Mode, Live for every principal until 02 and 03 set it.
- [ ] Every repository method filters reads and writes by the scope's Mode; a child row whose Mode differs from its parent's is refused.
- [ ] Sweeps and workers that load rows across Organizations build the next scope from the row's Organization and Mode.
- [ ] The isolation test is extended to fail when a query on a Mode-owned table omits the Mode, and it covers the API Key repository.
- [ ] Test fixtures (`organizations.ts`, `api-keys.ts`, `checkout.ts`, `reset-db.ts`) accept a Mode and default to Live.
- [ ] Integration tests: the same Upstream Reference can exist once in each Mode; a Test-scoped read never returns a Live row and the reverse; the full existing suite passes unchanged.
