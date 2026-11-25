# 09: API Keys

**What to build:** An Organization's own system calls the payments API with an API Key that belongs to that Organization, and every Payment it creates belongs to that Organization. Organization Admins create, list and revoke keys. See the [spec](../spec.md) (API Keys).

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] An Organization Admin creates an API Key with a label; the full key is returned only once
- [ ] API Keys are stored as a hash with a recognisable prefix, created time, last-used time and revoked time
- [ ] Listing shows label, prefix, created and last-used times; several active keys can exist at once
- [ ] Revoking a key makes it fail on the next request
- [ ] The public payments API authenticates by API Key and takes the Organization from it; a missing, unknown or revoked key is refused
- [ ] A key of one Organization gets not-found for another Organization's Payment
- [ ] API Key management is a sensitive write
- [ ] The Console has an API Keys page in Organization settings
- [ ] The seed creates API Keys
- [ ] The payments API's existing integration tests now authenticate with an API Key; new tests cover creation, one-time display, revocation and cross-Organization refusal
