# 05: Gateway Connections per Mode

**What to build:** An Organization connects each PaymentGateway once per Mode, the plugin is built for that Mode, and Callbacks take their Gateway Connection's Mode. See the [spec](../spec.md) (Gateways) and [ADR 0012](../../../docs/adr/0012-gateway-connections-per-mode-and-a-built-in-test-gateway.md).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GatewayPluginFactory.create` receives the Mode; each factory declares the Modes it supports, and connecting a PaymentGateway in an unsupported Mode is refused.
- [ ] At most one Gateway Connection per Organization, PaymentGateway and Mode; `ConnectionPlugins` looks up by all three and the plugin cache key includes the Mode.
- [ ] The Stripe plugin refuses `sk_live_`/`rk_live_` keys on a Test connection and `sk_test_`/`rk_test_` keys on a Live one; it no longer infers its Mode from the key.
- [ ] Callback intake gives the stored Callback, and everything Core does with it, the Gateway Connection's Mode.
- [ ] A PaymentTransaction uses only Gateway Connections of its Payment's Mode.
- [ ] The Console Gateways page shows the selected Mode's connections, each with its own Callback URL.
- [ ] Tests: connect Stripe in both Modes; wrong-Mode credentials refused; a Test Payment never uses the Live connection; a Callback to a Test connection updates only Test data.
