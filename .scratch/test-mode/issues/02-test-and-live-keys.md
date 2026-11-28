# 02: Test and Live keys

**What to build:** API Keys and Publishable Keys are created in a Mode, show it in their prefix, and every request runs in its key's Mode. See the [spec](../spec.md) (Keys).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Creating an API Key or Publishable Key takes a Mode; API Keys are `pb_test_…` / `pb_live_…`, Publishable Keys `pb_pk_test_…` / `pb_pk_live_…`. Existing `pb_live_` and `pb_pk_` keys keep working as Live.
- [ ] `AuthenticateApiKey` and the Publishable Key resolver return the Mode; the principal and scope carry it. No header, body or query parameter can change a key's Mode.
- [ ] Payments, PaymentTransactions and Refunds created or read with a Test key are Test; a Test key gets "not found" for Live records and the reverse.
- [ ] A Test Publishable Key accepts `http://localhost` and `http://127.0.0.1` origins on any port in every environment; a Live key accepts only `https` origins (plus `localhost` outside production, as today).
- [ ] Key listings return only the selected Mode's keys.
- [ ] A suspended Organization's keys are refused in both Modes.
- [ ] Integration tests cover creation in each Mode, prefixes, legacy keys, cross-Mode refusal on every payments and checkout endpoint, origin rules per Mode and suspension.
