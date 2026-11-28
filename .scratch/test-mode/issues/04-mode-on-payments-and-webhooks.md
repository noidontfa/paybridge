# 04: Mode on Payment reads and Webhooks

**What to build:** Every Payment read and every Webhook says its Mode, and each Webhook Endpoint receives only its own Mode's Webhooks. See the [spec](../spec.md) (Webhooks).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Payment reads in the public API include `mode` (`"test"` / `"live"`).
- [ ] `WebhookEnvelope` / `envelopeOf` include `mode`; the signature covers it as part of the body.
- [ ] Webhook Endpoints are created in a Mode, each with its own signing secret; fan-out (`listSubscribed`) delivers a Payment Event only to Endpoints of its Mode.
- [ ] Retries, resends and secret rotation work per Mode, unchanged otherwise.
- [ ] Integration tests: a Test Payment Event reaches only Test Endpoints and a Live one only Live Endpoints; `mode` appears in the signed body and on Payment reads.
