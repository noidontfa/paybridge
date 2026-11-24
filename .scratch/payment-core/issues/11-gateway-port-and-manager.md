# 11: Gateway port and Gateway Manager

Status: resolved

**What to build:** Core owns the `PaymentGateway` contract and the boot-time registry of plugins. A deployment with a duplicate or missing plugin fails at boot. A fake plugin is available for every later ticket's tests. No real provider is implemented.

**Blocked by:** None (can start immediately)

- [x] The port declares `initiate`, `query`, `cancel` and `parseCallback` with the input and output shapes from the spec. There are no refund operations.
- [x] Each plugin declares a constant gateway identifier and capability flags (for example `supportsCancel`).
- [x] The next-action union has four variants (redirect, QR code, client SDK, voucher). A type-level test shows that adding a variant does not break existing narrowing.
- [x] The five error categories (`GatewayRejected`, `GatewayUnavailable`, `OutcomeUnknown`, `InvalidCallback`, `NotFound`) each carry a retryable flag.
- [x] The normalised outcome allows only `PENDING`, `SUCCEEDED`, `FAILED`, `REQUIRES_REVIEW`. `EXPIRED` and `CANCELLED` are not representable in the plugin output.
- [x] The Gateway Manager builds the map from gateway identifier to plugin at boot. Boot fails with a clear error on a duplicate identifier.
- [x] Resolving a plugin for an attempt whose gateway identifier is not registered fails with a clear error.
- [x] Plugins are registered explicitly in the composition root only; there is no automatic scanning.
- [x] The Core module exports no plugin types.
- [x] A fake plugin is available to tests, with scripted results.
