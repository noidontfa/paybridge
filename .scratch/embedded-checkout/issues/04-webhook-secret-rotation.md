# 04: Webhook signing secret rotation

**What to build:** An Organization Admin rolls a Webhook Endpoint's signing secret without missing or rejecting deliveries. For a while, deliveries carry signatures under both the new and the old secret, so the Organization can update its receiver at its own pace. See the [spec](../spec.md) (Webhook Endpoint and delivery).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] An Organization Admin rolls an endpoint's secret. The new secret is returned in full once. The old secret stays valid until an end time chosen from a short list (for example now, 1 hour, 24 hours).
- [ ] Until that end time, the signature header carries one signature per valid secret. Afterwards it carries only the new one.
- [ ] Rolling again while an old secret is still valid replaces the older secret.
- [ ] Operators are refused. The roll is a sensitive write and is recorded in the audit log.
- [ ] The Webhook Endpoints page shows when the previous secret expires.
- [ ] Integration tests use the local receiver and `FakeClock`. They assert that both signatures verify during the overlap and only the new one verifies after it.
