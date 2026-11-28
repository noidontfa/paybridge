# 10: Delete all Test data

**What to build:** An Organization Admin deletes all of the Organization's Test data at once. See the [spec](../spec.md) (story 29) and [ADR 0011](../../../docs/adr/0011-mode-is-a-second-scope-inside-an-organization.md).

**Blocked by:** 01, 03

**Status:** needs-triage

Deferred by agreement on 2026-11-28: not part of the first slice.

- [ ] A Test-Mode-only Console action (Organization Admin, sensitive write, typed confirmation) deletes every Test Payment, PaymentTransaction, Refund, Review, Payment Event and Webhook; keys, Gateway Connections, Webhook Endpoints, Pricing Plans and Pricing Tables are kept.
- [ ] Live data is never touched; the deletion runs as a background job and is recorded with the User who started it.
- [ ] Tests: Live rows unchanged, Test rows gone, Upstream References reusable afterwards.
