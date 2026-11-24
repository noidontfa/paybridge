# 02: Ignored callbacks in the port

Status: ready-for-agent

**What to build:** A Gateway Plugin can tell Core that a verified callback is irrelevant (an event type it does not handle, or a provider object PayBridge did not create). Core acknowledges it with the plugin's acknowledgement and stores nothing, so it never becomes a `FAILED` webhook inbox row that alerts every hour. See [spec](../spec.md), "Core change 2".

**Blocked by:** None (can start immediately)

- [ ] `parseCallback` can return an ignored result carrying a `CallbackAck`, alongside the existing handled result. The fake plugin keeps compiling with minimal change.
- [ ] Webhook intake (`apps/api/src/payment-core/application/webhook-intake.ts`) replies with the ignored result's acknowledgement and writes no `core_webhook_inbox` row. It logs at debug level with the gateway id.
- [ ] Webhook processing (`process-webhook.ts`): a stored row that re-parses as ignored is marked processed with no state change and no error.
- [ ] Signature verification still comes first: an unsigned or tampered callback is `InvalidCallback`, never ignored.
- [ ] The contract suite registration gains an optional `ignoredCallbacks` list. Each entry must produce an ignored result with a 2xx acknowledgement.
- [ ] The fake plugin has one ignored case (for example an unknown event type), and its contract registration exercises it.
- [ ] Tests: intake acknowledges and does not store an ignored callback; processing handles a re-parsed ignored row.
