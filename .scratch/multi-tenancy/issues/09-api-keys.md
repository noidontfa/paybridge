# 09: API Keys

**What to build:** An Organization's own system calls the payments API with an API Key that belongs to that Organization, and every Payment it creates belongs to that Organization. Organization Admins create, list and revoke keys. See the [spec](../spec.md) (API Keys).

**Blocked by:** 05

**Status:** done

- [x] An Organization Admin creates an API Key with a label; the full key is returned only once
- [x] API Keys are stored as a hash with a recognisable prefix, created time, last-used time and revoked time
- [x] Listing shows label, prefix, created and last-used times; several active keys can exist at once
- [x] Revoking a key makes it fail on the next request
- [x] The public payments API authenticates by API Key and takes the Organization from it; a missing, unknown or revoked key is refused
- [x] A key of one Organization gets not-found for another Organization's Payment
- [x] API Key management is a sensitive write
- [x] The Console has an API Keys page in Organization settings
- [x] The seed creates API Keys
- [x] The payments API's existing integration tests now authenticate with an API Key; new tests cover creation, one-time display, revocation and cross-Organization refusal

## Notes

- The browser-return route (`/api/payments/:id/return`) and Callback routes (`/api/webhooks/*`) carry no API Key (a customer's browser and gateways cannot hold one). They stay on the default-Organization stub until the Gateway Connections ticket (webhooks) and a later decision (browser return).
- Revoke is `POST /internal/api-keys/:id/revoke` because the BFF forwards only GET, HEAD and POST.
