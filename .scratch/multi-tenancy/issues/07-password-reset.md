# 07: Password Reset and change password

**What to build:** A User who forgot their password can reset it from an emailed link, and a signed-in User can change it. Both sign the User out everywhere else. See the [spec](../spec.md) (Password Reset).

**Blocked by:** 03, 04

**Status:** done

- [x] Requesting a Password Reset gives the same response for any email; only a known, active User receives an email
- [x] The reset link is single-use, expires after 30 minutes and is stored hashed
- [x] Completing a reset sets the new password (at least 12 characters) and revokes all the User's refresh tokens
- [x] A signed-in User can change their password by giving the current one; this revokes their other refresh tokens
- [x] The Console has forgot-password, reset-password and change-password pages
- [x] Integration tests read the link from the recording email adapter and cover known and unknown email, single use, expiry, too-short password and revocation of other tokens
