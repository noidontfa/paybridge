# 04: Users, sign-in and tokens

**What to build:** People sign in to the Console with email and password and stay signed in through tokens held by the BFF, and every operator action is recorded under the signed-in User and their Role. The stub principal from ticket 02 is replaced by a real one derived from the token. See the [spec](../spec.md) (Tokens, BFF, Sign-in) and [ADR 0008](../../../docs/adr/0008-short-lived-jwt-with-db-checked-sensitive-writes.md).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Users have an email (unique across PayBridge), a password hash (argon2id, at least 12 characters), a Role (Super Admin, Organization Admin or Operator), an Organization (none for a Super Admin) and an active flag
- [ ] A CLI command creates a Super Admin, and works even when Super Admins already exist
- [ ] The seed creates a Super Admin, Organization Admins and Operators that all share one fixed development password
- [ ] Sign-in returns the same error for an unknown email and a wrong password; a deactivated User or a User of a suspended Organization cannot sign in
- [ ] Sign-in issues an ES256 access JWT (5 minutes; User, Role, Organization, Permissions) and a refresh token (7 days at most, 24 hours idle) stored hashed
- [ ] Refresh rotates the refresh token; presenting a used refresh token revokes its whole family
- [ ] Sign-out revokes the refresh token; public keys are published as a JWKS
- [ ] The API derives the principal from the verified access token, and Payment Core takes the Organization scope from it; a request without a valid token to an operator route is refused
- [ ] Status transitions record the acting User's id and the Role they held
- [ ] The BFF holds both tokens in httpOnly cookies, forwards the access token, refreshes on expiry, redirects to sign-in when refresh fails, never returns a token to the browser, and still strips upstream `set-cookie`; its existing unit tests cover this
- [ ] The Console has a sign-in page, a sign-out action, and shows the signed-in User, Role and Organization
- [ ] Integration tests over HTTP cover sign-in, refresh, rotation, reuse detection, sign-out and the refusals above
