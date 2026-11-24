# 18: Verified webhook intake

Status: resolved

**What to build:** A provider's server-to-server callback is verified and stored before anything else happens, then acknowledged at once. Forged callbacks change nothing. Duplicates are acknowledged without being processed again. Processing happens later (ticket 19).

**Blocked by:** 10: Transaction runner, repositories and queue connection; 11: Gateway port and Gateway Manager

- [x] The webhook route keeps the raw request body bytes unchanged, so signature checks that depend on exact bytes still work.
- [x] The plugin verifies the signature before any row is written. A forged callback leaves no inbox row and changes no state.
- [x] An invalid callback receives the plugin's error acknowledgement. Nothing is stored, and only the rejection reason is logged, not the body.
- [x] A valid callback is stored with raw body, allow-listed headers, query, gateway identifier, dedupe key, attempt key (when the plugin derives it) and status `RECEIVED`, before the acknowledgement is sent.
- [x] The dedupe key is the provider event id when present, otherwise the SHA-256 of the raw body.
- [x] A duplicate, by event id or by body hash, receives the success acknowledgement and creates no second row. This holds under concurrent deliveries.
- [x] The acknowledgement is returned as soon as the row is stored, without waiting for processing.
- [x] The attempt key on the inbox row has no foreign key constraint.
