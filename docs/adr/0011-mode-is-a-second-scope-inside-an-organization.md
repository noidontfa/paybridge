# Test and Live are Modes inside one Organization, scoped like the Organization itself

Every Organization has two Modes, Live and Test, and each Payment, PaymentTransaction, Refund, Review, Payment Event, Webhook, Webhook Endpoint, API Key, Publishable Key, Gateway Connection, Pricing Plan and Pricing Table belongs to exactly one of them. The Mode is a second scope next to the Organization scope of [ADR 0006](0006-organization-isolation-enforced-in-the-application.md): it comes only from the authenticated principal (the API Key's or Publishable Key's Mode, or the Mode the Console's BFF sends for a User), every repository method takes it, and a test checks that every such query filters by it. We chose this over a separate sandbox Organization because Users, Roles and Permissions are the same in both Modes and a User belongs to exactly one Organization; a linked sandbox Organization would have duplicated every User and needed a new "linked Organization" concept. The cost is that isolation between Modes, like isolation between Organizations, depends on discipline and tests: a repository that forgets the Mode mixes test data into live.

## Considered Options

- **A sandbox Organization linked to each real one** (rejected): reuses Organization isolation for free, but duplicates Users and Invitations and splits one business across two Organizations.
- **A per-request flag or header choosing the Mode** (rejected): one key could reach both Modes, so a misconfigured client could move real money while its developer thinks they are testing.
- **Mode fixed by the credential, enforced as a second application scope** (chosen).

## Consequences

- Keys show their Mode in their prefix (`pb_test_…`, `pb_live_…`), and every Webhook payload and every Payment read carries `mode`, so a receiver can reject an event from the wrong Mode.
- Uniqueness rules that were per Organization become per Organization and Mode; in particular an Upstream Reference used in Test never blocks the same reference in Live.
- Pricing Plans and Pricing Tables are not shared between Modes. A Test one is copied into Live as an independent record; an Embedded Checkout whose Publishable Key and Pricing Table are in different Modes shows the table as unavailable rather than falling back to the other Mode.
- Live is available from the day an Organization is created; there is no activation step, because PayBridge never holds funds ([ADR 0007](0007-organizations-bring-their-own-gateway-accounts.md)). Adding one later does not change the model.
- An Organization Admin can delete all of an Organization's Test data at once. This is the only way Payments are ever deleted, and it never touches Live.
- Test Mode runs the same re-query, Payment Expiry, Review, reconciliation and Webhook retry processes as Live, on the same queues and workers ([ADR 0002](0002-postgresql-source-of-truth-bullmq-dispatch.md)). Split them if test load ever affects Live.
- All data that existed before Modes is backfilled as Live; the seed data creates its scenarios in Test.
