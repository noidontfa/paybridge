# Short-lived JWTs, with sensitive writes checked against the database

Users authenticate with a short-lived access JWT (ES256, 5 minutes) signed by the `identity` module and carrying the User, Organization, Role and Permissions, plus a rotating refresh token stored hashed in the database (7 days at most, 24 hours idle). We chose JWTs over server-side sessions so that any API instance, and any future service, can verify a request with only the public key, without a database or `identity` lookup per request. The cost is that a revoked User keeps read access until their access token expires. We close that gap for what matters: every sensitive write (resolving a Review, managing Users, API Keys, Gateway Connections or Organizations) re-checks in the database that the User is still active, still holds that Role, and that the Organization is not suspended.

## Considered Options

- **Server-side sessions in Postgres, checked on every request** (rejected): revocation is immediate, but every request needs a lookup, which works against scaling out.
- **JWT plus a per-request `authVersion` check in Redis** (rejected): it is immediate too, but it brings back a lookup per request and gives up the point of a JWT.
- **Short JWT, revocable refresh token, database check on sensitive writes** (chosen).

## Consequences

- Deactivating a User, changing their Role, changing their password or suspending their Organization revokes their refresh tokens. Sensitive writes are refused at once; reads stop within 5 minutes.
- When a refresh token that has already been used is presented again, it is treated as stolen, and its whole token family is revoked.
- Both tokens live in httpOnly cookies held by the BFF (ADR 0004), which refreshes them. The browser never reads a token.
- Public keys are published as a JWKS so signing keys can rotate. A future service verifies tokens on its own, but it must make the same database check before any sensitive write.
- A new write endpoint must decide explicitly whether it is sensitive. A future reader should not drop the database check for "performance".
