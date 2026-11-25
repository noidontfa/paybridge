# 04: Users, sign-in and tokens

**What to build:** People sign in to the Console with email and password and stay signed in through tokens held by the BFF, and every operator action is recorded under the signed-in User and their Role. The stub principal from ticket 02 is replaced by a real one derived from the token. See the [spec](../spec.md) (Tokens, BFF, Sign-in) and [ADR 0008](../../../docs/adr/0008-short-lived-jwt-with-db-checked-sensitive-writes.md).

**Blocked by:** 02

**Status:** done

- [x] Users have an email (unique across PayBridge), a password hash (argon2id, at least 12 characters), a Role (Super Admin, Organization Admin or Operator), an Organization (none for a Super Admin) and an active flag
- [x] A CLI command creates a Super Admin, and works even when Super Admins already exist
- [x] The seed creates a Super Admin, Organization Admins and Operators that all share one fixed development password
- [x] Sign-in returns the same error for an unknown email and a wrong password; a deactivated User or a User of a suspended Organization cannot sign in
- [x] Sign-in issues an ES256 access JWT (5 minutes; User, Role, Organization, Permissions) and a refresh token (7 days at most, 24 hours idle) stored hashed
- [x] Refresh rotates the refresh token; presenting a used refresh token revokes its whole family
- [x] Sign-out revokes the refresh token; public keys are published as a JWKS
- [x] The API derives the principal from the verified access token, and Payment Core takes the Organization scope from it; a request without a valid token to an operator route is refused
- [x] Status transitions record the acting User's id and the Role they held
- [x] The BFF holds both tokens in httpOnly cookies, forwards the access token, refreshes on expiry, redirects to sign-in when refresh fails, never returns a token to the browser, and still strips upstream `set-cookie`; its existing unit tests cover this
- [x] The Console has a sign-in page, a sign-out action, and shows the signed-in User, Role and Organization
- [x] Integration tests over HTTP cover sign-in, refresh, rotation, reuse detection, sign-out and the refusals above

## Notes from implementation

- Sign-in, refresh and sign-out live at `/internal/auth/*` (called only by the BFF); the JWKS is at `/.well-known/jwks.json`. `GET /internal/auth/me` returns the signed-in User for the Console.
- The signing key is `AUTH_JWT_PRIVATE_KEY` (ES256 PKCS#8 PEM). Unset, a fresh key is generated per process (development and tests); production refuses to start without it. The JWKS publishes the current key only: publishing retired keys for rotation is not built yet.
- The public payments API (`/api/*`) still uses the stub principal (default Organization) until API Keys (ticket 09). Only `/internal/*` needs a token.
- A Super Admin has no Organization, so scoped operator routes answer 403 `ORGANIZATION_REQUIRED` until ticket 05 adds the chosen-Organization and "all Organizations" scopes.
- Permissions are in the token and mapped in code, but no route checks one yet (ticket 05).
- Status transitions gained an `actor_role` column; `actor` is the User's id. The audit list returns `actorRole`.
- CLI: `pnpm --filter @paybridge/api identity:create-super-admin --email ... --name ...` with the password in `SUPER_ADMIN_PASSWORD`. For an existing Super Admin's email it recovers the account (new password, active, signed out everywhere).
- Seed password for every seeded User: `paybridge-dev-password` (`super.admin@paybridge.dev`, `admin@` / `operator@` `default.paybridge.dev` and `acme.paybridge.dev`).
- BFF: a refresh token is single-use, so concurrent refreshes in one Console process share one API call (`refresh-once.ts`); several Console instances would need sticky routing. Mock mode has no sign-in.
