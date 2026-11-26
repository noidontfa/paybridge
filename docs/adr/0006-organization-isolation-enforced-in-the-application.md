# Organization isolation is enforced in the application, not by Postgres RLS

Every `core_*` row that belongs to an Organization carries an `organization_id`, and the rule that one Organization never sees another's data is enforced in application code: every repository method that reads or writes Organization data takes an explicit Organization scope, and a test checks that every such query filters by it. We did not use Postgres Row-Level Security, because Prisma has no first-class support for setting a per-request session variable on a pooled connection, and a Super Admin must be able to read and act across every Organization, which under RLS needs a bypass role or policy on every table. The cost is that isolation depends on discipline and tests, not on the database: a repository that forgets the scope leaks data.

## Considered Options

- **Postgres RLS with `app.organization_id` set per request** (rejected): the database enforces isolation even against a buggy query, but it fights Prisma's connection pooling and needs a Super Admin bypass everywhere.
- **One Postgres schema or database per Organization** (rejected): [ADR 0001](0001-shared-public-schema-with-table-prefix-ownership.md) fixes a single shared `public` schema.
- **Explicit Organization scope in every repository, checked by tests** (chosen).

## Consequences

- The Organization scope comes from the authenticated principal (a User's access token or an API Key), never from a request body or query parameter. A Super Admin's scope is "all Organizations" or a chosen one, and it is explicit in the call.
- Data that existed before Organizations is backfilled into one default Organization, and the seed data creates its scenarios inside Organizations.
- If a cross-Organization leak ever happens in production, revisit RLS as a second layer under the application check.
