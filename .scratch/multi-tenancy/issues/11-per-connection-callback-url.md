# 11: Callback URL per Gateway Connection and Stripe migration

**What to build:** Callbacks arrive at a URL that names the Gateway Connection, so each one is verified with the right Organization's secret, and the env-configured Stripe account moves into the default Organization without losing a Callback. See the [spec](../spec.md) (Callback URL, Migration).

**Blocked by:** 10

**Status:** done

- [x] The webhooks route takes the gateway identifier and the Gateway Connection id; intake resolves the Gateway Connection, verifies with its plugin instance and stores the Callback with its Organization
- [x] An unknown Gateway Connection id, a mismatched gateway or an invalid signature is refused as Callbacks are today
- [x] Callbacks to a disabled Gateway Connection are still processed
- [x] The Console's Gateways view shows the per-connection Callback URL built from the public base URL
- [x] A one-off CLI command copies the env Stripe account into the default Organization's Stripe Gateway Connection
- [x] The existing route without a connection id forwards to the default Organization's Stripe Gateway Connection, so Callbacks keep arriving until the Stripe dashboard is updated
- [x] Integration tests cover the new route, refusals, the legacy route and the import command
