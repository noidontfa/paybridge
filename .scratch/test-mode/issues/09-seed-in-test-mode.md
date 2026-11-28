# 09: Seed data in Test Mode

**What to build:** The dev seed creates its scenarios in Test Mode, so a fresh environment shows PayBridge the way a new Organization will use it. See the [spec](../spec.md) and [ADR 0011](../../../docs/adr/0011-mode-is-a-second-scope-inside-an-organization.md) (Consequences).

**Blocked by:** 02, 05, 06

**Status:** ready-for-agent

- [ ] The seed's Payments, Reviews, keys, Webhook Endpoints, Pricing Plans and Pricing Tables are created in Test Mode, using the Test Gateway and Stripe test credentials.
- [ ] The seed prints the Test API Key and Test Publishable Key it created.
- [ ] Any docs or README steps that use seeded keys are updated.
- [ ] The seed runs cleanly on an empty database and is covered by its existing test.
