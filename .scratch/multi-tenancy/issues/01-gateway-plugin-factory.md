# 01: Prefactor: Gateway Plugin factory

**What to build:** Each Gateway Plugin is registered as a factory that builds an instance from one set of credentials, and the Gateway Manager builds and caches those instances itself instead of receiving ready-built plugins. Credentials still come from environment variables, so behaviour does not change: this makes ticket 10 (Gateway Connections) a small change instead of a rewrite. See the [spec](../spec.md) (Implementation Decisions, Gateway Connections) and [ADR 0007](../../../docs/adr/0007-organizations-bring-their-own-gateway-accounts.md).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Stripe and `fake` plugins each register a factory that takes credentials and returns a plugin instance
- [ ] The Gateway Manager finds a plugin instance by gateway identifier through the factories, building each instance once and caching it by a key that can later include a Gateway Connection id and credentials version
- [ ] Stripe credentials are still read from env; with no Stripe env, only `fake` is available outside production, exactly as today
- [ ] Every existing unit, contract and integration test passes unchanged in behaviour (test setup may change where it built plugins directly)
- [ ] Core's boundary specs still pass: Core does not depend on any plugin
