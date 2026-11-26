# Map: Multi-tenant Organizations with role-based access

## Destination

PayBridge serves many Organizations from one deployment. Every Payment and everything under it belongs to exactly one Organization, and no Organization can see another's data. People sign in as Users with one of three fixed Roles: **Super Admin** runs the platform and belongs to no Organization, **Organization Admin** manages one Organization, and **Operator** works inside one Organization. Access is decided by Permission. Each Organization's own system calls PayBridge with its own API Keys and collects money through its own Gateway Connections.

## Notes

- **Spec**: [spec.md](spec.md) (`ready-for-agent`).
- **Context**: single context. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). This effort added Organization, User, Invitation, Password Reset, Role, Permission, API Key, Gateway Connection, Super Admin and Organization Admin. It also redefined Operator (a User of one Organization) and Upstream Reference (unique within an Organization), and it replaced "merchant" with Organization in Callback and Webhook.
- **ADRs from this effort**: [ADR 0008](../../docs/adr/0008-short-lived-jwt-with-db-checked-sensitive-writes.md) (short-lived JWT with database-checked sensitive writes), [ADR 0006](../../docs/adr/0006-organization-isolation-enforced-in-the-application.md) (isolation in the application, not RLS), [ADR 0007](../../docs/adr/0007-organizations-bring-their-own-gateway-accounts.md) (Organizations bring their own gateway accounts).
- **Related**: [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md) (one `public` schema, table-prefix ownership), [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md) (session lives in the BFF), [ADR 0005](../../docs/adr/0005-operator-read-models-live-in-payment-core.md) (the module that owns a prefix owns its reads and writes), [Console API connection map](../console-api-connection/map.md).
- **State today**:
  - There is no authentication. `/internal/*` is protected only by being off the public ingress.
  - The BFF stamps `actor` on writes from a stub seam (`apps/console/src/server/current-operator.ts`).
  - No `core_*` table has an Organization column, and `merchant_order_id` is unique across PayBridge.
  - Stripe credentials are single, platform-wide env variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`). Callbacks arrive at `/api/webhooks/:gatewayId`.
  - The seed (`apps/api/seed/`) creates about 22 Payments with no Organization.

## Decisions so far

Settled by grilling on 2026-11-25:

- **Organization is the tenant.** It is the canonical term; "Merchant" and "Tenant" are avoided in domain language. Code names such as `merchantOrderId` stay as they are.
- **Isolation**: every Payment, PaymentTransaction, Refund, Review, Callback, Payment Event and status transition belongs to exactly one Organization. Isolation is enforced in application code: every repository method that touches Organization data takes an explicit Organization scope, and a test checks that every such query filters by it. There is no Postgres RLS (ADR 0006).
- **Where the scope comes from**: always from the authenticated principal (a User's access token or an API Key), never from a request body or query parameter.
- **Upstream Reference** is unique per Organization: `(organization_id, merchant_order_id)` is the unique key.
- **Users**: a User belongs to exactly one Organization, except a Super Admin, who belongs to none. A person working for two Organizations has two Users. There is no multi-Organization membership.
- **RBAC**: three fixed Roles map to Permissions defined in code. Checks are always by Permission, never by Role name, so custom Roles can be added later by moving the map into the database. Organization Admin is a superset of Operator.

  | Permission | Operator | Org Admin | Super Admin |
  |---|---|---|---|
  | View Payments, Reviews, Callbacks, Payment Events | ✅ | ✅ | ✅ (every Organization) |
  | Resolve Review | ✅ | ✅ | ✅ |
  | Manage the Organization's Users (invite, change Role, deactivate) | ❌ | ✅ | ✅ |
  | Manage API Keys | ❌ | ✅ | ✅ |
  | Manage Gateway Connections (credentials, enable/disable) | ❌ | ✅ | ✅ |
  | Create and suspend Organizations | ❌ | ❌ | ✅ |
  | Manage other Super Admins | ❌ | ❌ | ✅ |

- **Super Admin acts with full power** in any Organization, including resolving Reviews. Every such action is recorded under the real User and the Role they held, and the Organization sees it labelled as done by the platform ("Super Admin (PayBridge)"). A note is required, as for every status change. There is no impersonation.
- **Organization Admins**: an Organization can have several. It must always keep at least one active Organization Admin: demoting or deactivating the last one is refused. A Super Admin can appoint a new Organization Admin to recover an Organization.
- **Onboarding and sign-in**:
  - The first Super Admin is created by a seed or CLI command. There is no public sign-up.
  - Super Admins invite an Organization's first Organization Admin, and Organization Admins invite everyone else, by **Invitation** email. The invitee sets their own password when accepting.
  - Users sign in with email and password. The tokens live in the BFF (ADR 0004), which forwards them to the API.
- **Password Reset**: an emailed link lets a User set a new password. It works once and expires. The request never reveals whether an email address belongs to a User, so an unknown address gets the same response as a known one.
- **Deactivating a User**: the User can no longer sign in, and their sensitive writes are refused at once; read access ends within 5 minutes (see ADR 0008). Their past actions stay recorded under their name.
- **Email**: one email-sending port serves Invitations and Password Resets. In development and tests the implementation is a **mock that writes to the console log** the recipient, subject and the full link (Invitation or Password Reset), so the flow can be tested by copying the link. A real provider replaces only the adapter later.
- **API Keys**: an Organization's own system calls the payments API with an API Key that belongs to that Organization. The Organization is derived from the key. An Organization can hold several keys at once so it can rotate them. Organization Admins create and revoke them. A key is shown only once when it is created; the database stores a hash and a recognisable prefix (for example `pb_live_ab12…`).
- **Gateway Connections**: each Organization connects its own account with each PaymentGateway, and money goes straight to the Organization; PayBridge never holds funds (ADR 0007). Details:
  - There is at most one Gateway Connection per PaymentGateway per Organization.
  - Organization Admins can enable or disable it. Disabling stops new PaymentTransactions through that gateway only; Callbacks, re-queries, reconciliation and Refunds for existing ones keep working. A Gateway Connection that has been used is never deleted.
  - Credentials are encrypted at rest and are never returned to the Console after saving.
  - The callback URL identifies the Organization, so the right secret can verify the signature.
- **Suspending an Organization** (Super Admin): its API Keys are refused and its Users cannot sign in. Callbacks for attempts already under way are still processed, so money a customer has paid is never lost track of.
- **Console**: one Console for everyone. A Super Admin gets an Organization switcher with an "All Organizations" read view, plus a separate **Platform** area for managing Organizations and Super Admins. Every write requires exactly one chosen Organization; there are no bulk writes across Organizations.
- **Existing data**: a migration creates one default Organization, assigns all existing rows to it, then makes `organization_id` `NOT NULL`. The **seed is updated** to create its scenarios inside Organizations: at least two, so isolation is visible. It also creates Users of every Role and covers a suspended Organization and a disabled Gateway Connection.

- **IdentityModule** (Fog round 1, 2026-11-25): Organizations, Users, Invitations, Password Resets, sign-in and API Keys live in a new `identity` module with the `iam_` table prefix. Its folders mirror `payment-core`: `domain/` (entities and rules, no framework), `application/use-cases/`, `port/` (for example the email sender), `infrastructure/` (Prisma repositories, the console-log email adapter), `http/`. It has the same boundary checks: only `infrastructure/prisma/` imports the database client, and one transaction runner. Payment Core never reads `iam_` tables; it receives an authenticated principal (User or API Key, with its Organization and Permissions).
- **Organization references**: `core_*.organization_id` is a real foreign key to `iam_organizations`. Organizations are never deleted, only suspended.
- **Gateway Connections live in Payment Core** (`core_gateway_connections`). Each Gateway Plugin registers a factory that builds an instance from one Gateway Connection's credentials. The Gateway Manager builds instances per Gateway Connection and caches them by id and credentials version. The `fake` gateway's Gateway Connection has no credentials and exists outside production only.
- **Tokens and passwords**: Invitations expire after 7 days and Password Resets after 30 minutes. Both are single-use and stored only as hashes, and re-sending an Invitation voids the previous link. Passwords are hashed with argon2id and have at least 12 characters.
- **Credential encryption**: credentials are encrypted with AES-256-GCM using keys from `GATEWAY_CREDENTIALS_KEYS` (several keys, each with an id). Each row records the id of the key that encrypted it. Rotation means adding a new primary key, then running a CLI command that re-encrypts every row. In production the API refuses to start without a key.
- **Callback URL**: `/api/webhooks/:gatewayId/:connectionId`, where `connectionId` is the Gateway Connection's uuid. A one-off CLI copies the env-configured Stripe account into the default Organization's Gateway Connection. The old `/api/webhooks/:gatewayId` route forwards to that Gateway Connection until the Stripe dashboard is updated. After that, the route and the `STRIPE_*` env variables are removed.
- **Super Admins**: a Super Admin invites another by Invitation. At least one active Super Admin must always remain. A Super Admin cannot change Role, only be deactivated. The CLI that creates a Super Admin also works when Super Admins already exist, for recovery.

- **Authentication tokens** ([ADR 0008](../../docs/adr/0008-short-lived-jwt-with-db-checked-sensitive-writes.md)):
  - The access JWT is signed with ES256, lives 5 minutes, carries User, Organization, Role and Permissions, and its keys are published as a JWKS.
  - The refresh token lasts 7 days at most and expires after 24 hours idle. It is stored hashed and rotated on every use; a reused refresh token revokes its whole family.
  - Both tokens sit in httpOnly cookies held by the BFF, which refreshes them.
  - Reads only verify the signature. Sensitive writes re-check the User, Role and Organization in the database.
  - Deactivation, a Role change, a password change or suspension revokes refresh tokens: writes are blocked at once, reads stop within 5 minutes.
- **Confirmed while writing the spec**: a Super Admin can reactivate a suspended Organization, and an Organization Admin can reactivate a deactivated User. A signed-in User can change their own password by giving the current one. The seed uses one fixed development password for every Role.

## Fog

Empty: every branch was settled by grilling on 2026-11-25.

## Tickets

- [01: Prefactor: Gateway Plugin factory](issues/01-gateway-plugin-factory.md)
- [02: Organizations in the schema (tracer bullet)](issues/02-organizations-in-the-schema.md)
- [03: Email port with console-log adapter](issues/03-email-port.md)
- [04: Users, sign-in and tokens](issues/04-users-sign-in-and-tokens.md) (blocked by 02)
- [05: Permissions, sensitive writes and Super Admin in an Organization](issues/05-permissions-and-sensitive-writes.md) (blocked by 04)
- [06: Invitations](issues/06-invitations.md) (blocked by 03, 05)
- [07: Password Reset and change password](issues/07-password-reset.md) (blocked by 03, 04)
- [08: User management](issues/08-user-management.md) (blocked by 05)
- [09: API Keys](issues/09-api-keys.md) (blocked by 05)
- [10: Gateway Connections](issues/10-gateway-connections.md) (blocked by 01, 05)
- [11: Callback URL per Gateway Connection and Stripe migration](issues/11-per-connection-callback-url.md) (blocked by 10)
- [12: Platform area](issues/12-platform-area.md) (blocked by 06, 08)

01, 02 and 03 can start immediately. After 05, tickets 06, 08, 09 and 10 are independent of each other. 07 needs only 03 and 04.

## Follow-ups (out of scope)

- One User in several Organizations (memberships).
- Custom Roles defined per Organization.
- SSO and MFA.
- Impersonation.
- A real email provider.
- Webhooks out to Organizations (still not built).
- Postgres RLS as a second isolation layer (revisit if a leak ever happens, per ADR 0006).
