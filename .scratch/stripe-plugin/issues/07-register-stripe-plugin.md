# 07: Register the Stripe plugin

Status: resolved

**What to build:** The composition root registers the Stripe plugin whenever the Stripe configuration is present, in every environment, so `gatewayId: "stripe"` works end to end. See [spec](../spec.md), "Location and registration".

**Blocked by:** 03, 04

- [ ] `apps/api/src/gateways/gateways.module.ts` builds the Stripe plugin from the resolved config and adds it to `GATEWAY_PLUGINS` when configured. The fake plugin's rule (outside production only) is unchanged.
- [ ] The module comment no longer lists Stripe as a future plugin.
- [ ] `gateways.module.spec.ts` covers: Stripe registered when configured; not registered when not configured; production with Stripe configured has exactly the Stripe plugin.
- [ ] The lint rule still passes: no Core module imports from `gateways/`.
- [ ] An e2e test starts an attempt with `gatewayId: "stripe"` against a recorded create response and receives a `CLIENT_SDK` next action with `clientParams`.
