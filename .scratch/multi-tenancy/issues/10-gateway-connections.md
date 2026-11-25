# 10: Gateway Connections

**What to build:** Each Organization connects its own PaymentGateway accounts and can enable or disable them; money goes straight to the Organization (ADR 0007). Starting a PaymentTransaction uses the Payment's Organization's Gateway Connection. See the [spec](../spec.md) (Gateway Connections).

**Blocked by:** 01, 05

**Status:** ready-for-agent

- [ ] Gateway Connections are owned by Payment Core: Organization, gateway identifier, encrypted credentials, the encrypting key's id, a credentials version, and enabled state; at most one per Organization per gateway
- [ ] Credentials are encrypted with AES-256-GCM using identified keys from configuration; the API refuses to start in production without one; a CLI command re-encrypts every row under the primary key
- [ ] No endpoint ever returns credentials; responses say only which fields are set
- [ ] Organization Admins create, replace credentials of, enable and disable their Gateway Connections; a used Gateway Connection cannot be deleted
- [ ] The Gateway Manager builds plugin instances per Gateway Connection from its decrypted credentials, cached by id and credentials version
- [ ] Starting a PaymentTransaction on a gateway the Organization has not connected or has disabled is refused with a clear error
- [ ] Re-queries, reconciliation, expiry handling and Refunds still work on a disabled Gateway Connection
- [ ] The `fake` gateway's Gateway Connection has no credentials and is available outside production only
- [ ] Gateway Connection management is a sensitive write
- [ ] The Console has a Gateway Connections page in Organization settings
- [ ] The seed creates Gateway Connections, one of them disabled
- [ ] Integration tests over HTTP cover each rule above, including the key-rotation command's observable result
