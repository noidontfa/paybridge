Status: ready-for-agent

# Spec: Multi-tenant Organizations with role-based access

Source: [Map: Multi-tenant Organizations with role-based access](map.md), settled by grilling on 2026-11-25. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Architecture decisions: [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md), [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md), [ADR 0005](../../docs/adr/0005-operator-read-models-live-in-payment-core.md), [ADR 0006](../../docs/adr/0006-organization-isolation-enforced-in-the-application.md), [ADR 0007](../../docs/adr/0007-organizations-bring-their-own-gateway-accounts.md) and [ADR 0008](../../docs/adr/0008-short-lived-jwt-with-db-checked-sensitive-writes.md).

## Problem Statement

PayBridge can serve only one business, and it has no notion of who is using it:

- **No sign-in.** Nobody signs in to the Console; operator routes are protected only by being off the public ingress, and every status change is attributed to a free-text actor.
- **Data is not owned.** Every Payment belongs to nobody in particular, and an Upstream Reference must be unique across the whole platform.
- **One gateway account.** One set of Stripe credentials, configured through environment variables, serves everything.
- **No access control.** There is no way to let one business manage its own people, keys and gateway accounts, to stop an Operator from changing settings, or to let the people who run PayBridge support and govern the businesses on it.

A second business cannot be onboarded without seeing, and being able to change, the first business's money.

## Solution

Make Organizations the tenants of PayBridge, and put every person behind a sign-in with one of three fixed Roles.

- **Isolation.** Every Payment, and everything under it, belongs to exactly one Organization. Nobody in one Organization can see or change another Organization's data. The application enforces this in every repository (ADR 0006).
- **Three Roles.**
  - **Super Admin**: runs the platform, belongs to no Organization, and can do anything in any Organization. Their actions are visibly labelled as the platform's.
  - **Organization Admin**: manages one Organization's Users, API Keys and Gateway Connections, plus everything an Operator does.
  - **Operator**: monitors one Organization's Payments and resolves its Reviews.
- **Permissions decide access.** Access is always checked by Permission, never by Role name.
- **People.** People join by Invitation email, sign in with email and password, and can reset a forgotten password by email. In development and tests, emails are written to the console log so every link can be followed by hand.
- **Tokens.** Sign-in issues a short-lived access JWT and a rotating refresh token, both held by the Console's BFF in httpOnly cookies. Reads verify only the signature, so the API scales out. Sensitive writes re-check the User, Role and Organization in the database, so deactivation, Role changes and suspension block writes at once (ADR 0008).
- **API Keys.** An Organization's own system calls the payments API with its own API Keys. The Organization is taken from the key.
- **Gateway Connections.** Each Organization connects its own PaymentGateway accounts, which it can enable or disable. Money goes straight to the Organization (ADR 0007). Callbacks arrive at a URL that names the Gateway Connection, so the right credentials verify them.
- **Super Admin console.** A Super Admin uses the same Console with an Organization switcher, an "All Organizations" read view, and a Platform area. From there they create and suspend Organizations and manage Super Admins.
- **Existing data.** All existing data moves into one default Organization, and the env-configured Stripe account becomes that Organization's Gateway Connection. The seed creates its scenarios inside several Organizations with Users of every Role.

## User Stories

### Organizations and isolation

1. As an Operator, I want to see only my Organization's Payments, so that I never act on another business's money.
2. As an Operator, I want every Payment list, detail, Review, Callback, Payment Event and audit view to be limited to my Organization, so that no screen leaks another business's data.
3. As an Operator, I want a link to another Organization's Payment to behave exactly like a Payment that does not exist, so that I cannot even learn that it exists.
4. As an Organization's developer, I want my Upstream Reference to be unique only within my Organization, so that my order numbers can never clash with another business's.
5. As an Organization's developer, I want creating a Payment with an Upstream Reference my Organization already used to fail as it does today, so that duplicate collection is still prevented.
6. As a Super Admin, I want to create an Organization with a name, so that a new business can start using PayBridge.
7. As a Super Admin, I want to invite an Organization's first Organization Admin when I create it, so that the business can take over its own management.
8. As a Super Admin, I want to suspend an Organization, so that a business that must stop using PayBridge stops creating new Payments.
9. As a Super Admin, I want a suspended Organization's Callbacks for attempts already under way to still be processed, so that money a customer has already paid is never lost track of.
10. As a Super Admin, I want to reactivate a suspended Organization, so that a business can resume once the issue is resolved.
11. As a User of a suspended Organization, I want a clear message that my Organization is suspended when I try to sign in, so that I know why I cannot get in.
12. As a Super Admin, I want Organizations never to be deleted, so that Payments and their history always keep their owner.

### Roles and Permissions

13. As an Operator, I want to view Payments, Reviews, Callbacks, Payment Events and the audit log of my Organization, so that I can monitor collections.
14. As an Operator, I want to resolve my Organization's Reviews, so that I can settle what Core could not.
15. As an Operator, I want to be refused when I try to manage Users, API Keys or Gateway Connections, so that settings stay with the people responsible for them.
16. As an Organization Admin, I want to do everything an Operator can, so that I do not need a second User for daily work.
17. As an Organization Admin, I want to manage my Organization's Users, API Keys and Gateway Connections, so that my business runs without asking the platform.
18. As an Organization Admin, I want to be refused when I try to create or suspend Organizations or manage Super Admins, so that platform control stays with the platform.
19. As a Super Admin, I want every Permission in every Organization, so that I can support and govern any business.
20. As a developer, I want every access check to ask for a Permission rather than a Role name, so that custom Roles can be added later without rewriting checks.
21. As a User, I want the Console to hide or disable actions I have no Permission for, so that I do not try things that will be refused.
22. As a User, I want the API to refuse an action I have no Permission for even if the Console shows it, so that the Console is never the only safeguard.

### Super Admin in an Organization

23. As a Super Admin, I want an Organization switcher in the Console, so that I can work inside one Organization at a time.
24. As a Super Admin, I want an "All Organizations" read view of Payments and Reviews, so that I can spot platform-wide problems.
25. As a Super Admin, I want every write to require exactly one chosen Organization, so that I can never change several businesses by accident.
26. As a Super Admin, I want to resolve a stuck Review in any Organization, with a note, so that I can help a business that asks for support.
27. As an Organization Admin, I want status changes made by a Super Admin to show as "Super Admin (PayBridge)" with their name and note, so that I know the platform acted on my data.
28. As an auditor, I want every status change to record the User and the Role they held at that moment, so that history stays accurate even after Roles change.

### Invitations

29. As an Organization Admin, I want to invite a person by email with a chosen Role (Operator or Organization Admin), so that they can join my Organization.
30. As an invitee, I want an email with a link where I set my own password, so that nobody else ever knows it.
31. As an invitee, I want the Invitation link to expire after 7 days, so that an old email cannot be used much later.
32. As an invitee, I want an Invitation link to work only once, so that a forwarded email cannot create a second account.
33. As an Organization Admin, I want to re-send an Invitation, which voids the previous link, so that a lost email can be replaced safely.
34. As an Organization Admin, I want to revoke a pending Invitation, so that a person I invited by mistake cannot join.
35. As an Organization Admin, I want to see pending Invitations with their Role and expiry, so that I know who has not joined yet.
36. As an Organization Admin, I want an Invitation to an email that already belongs to a User to be refused, so that one email address never has two Users.
37. As a Super Admin, I want to invite another Super Admin by the same Invitation flow, so that the platform team can grow.
38. As a developer, I want every email PayBridge sends in development and tests to be written to the console log with recipient, subject and full link, so that I can test Invitations and Password Resets without a mail server.

### Sign-in and tokens

39. As a User, I want to sign in with my email and password, so that I can use the Console.
40. As a User, I want a wrong email and a wrong password to produce the same error, so that nobody can find out which emails have accounts.
41. As a User, I want to stay signed in while I keep working, for up to 7 days, so that I am not asked to sign in all the time.
42. As a User, I want to be signed out after 24 hours without activity, so that a forgotten browser does not stay open forever.
43. As a User, I want to sign out, so that my tokens stop working on this device.
44. As a security reviewer, I want access tokens to live only 5 minutes and to be readable only by the BFF, never by browser scripts, so that a stolen token is of little use.
45. As a security reviewer, I want a refresh token that is used twice to revoke its whole token family, so that a stolen refresh token is detected and shut down.
46. As a platform engineer, I want any API instance, or a future service, to verify an access token with only the published public keys, so that the API scales out without a lookup per request.
47. As a platform engineer, I want signing keys published as a JWKS and rotatable, so that a key can be replaced without signing everyone out at once.
48. As a deactivated User, I want my next sensitive write to be refused at once, and my read access to end within 5 minutes, so that the Organization's data is protected after I leave.
49. As a User whose Role was lowered, I want my next sensitive write to be checked against my current Role, so that I cannot use a Permission I just lost.
50. As a User of a suspended Organization, I want my next sensitive write to be refused at once, so that suspension takes effect immediately.

### Password Reset

51. As a User who forgot my password, I want to request a Password Reset by email, so that I can get back in.
52. As anyone, I want a Password Reset request for an unknown email to get the same response as for a known one, so that the form cannot be used to find accounts.
53. As a User, I want the reset link to work only once and to expire after 30 minutes, so that an old email cannot be used to take over my account.
54. As a User, I want resetting or changing my password to sign me out everywhere else, so that anyone using my old password is locked out.
55. As a User, I want to change my password while signed in by giving my current one, so that I can rotate it myself.
56. As a User, I want passwords shorter than 12 characters to be refused, so that my account has a minimum strength.

### User management

57. As an Organization Admin, I want to list my Organization's Users with their Role and whether they are active, so that I know who has access.
58. As an Organization Admin, I want to change a User's Role between Operator and Organization Admin, so that responsibilities can change.
59. As an Organization Admin, I want to deactivate a User, so that someone who left loses access.
60. As an Organization Admin, I want to reactivate a deactivated User, so that a returning person can come back without a new account.
61. As an Organization Admin, I want demoting or deactivating the last active Organization Admin to be refused, so that my Organization is never left unmanageable.
62. As a Super Admin, I want to appoint a new Organization Admin in any Organization, so that I can recover a business whose admins are gone.
63. As a Super Admin, I want deactivating the last active Super Admin to be refused, so that the platform is never left without one.
64. As a platform engineer, I want a command that creates a Super Admin, which also works when Super Admins already exist, so that I can bootstrap and recover the platform.
65. As an auditor, I want a deactivated User's past actions to stay recorded under their name, so that history is never rewritten.

### API Keys

66. As an Organization Admin, I want to create an API Key with a label, so that my system can call PayBridge.
67. As an Organization Admin, I want the full key shown only once, at creation, so that it is never readable again from PayBridge.
68. As an Organization Admin, I want to see my API Keys by label, recognisable prefix, creation time and last use, so that I can tell them apart.
69. As an Organization Admin, I want to hold several active API Keys at once, so that I can rotate a key without downtime.
70. As an Organization Admin, I want to revoke an API Key, so that a leaked key stops working at once.
71. As an Organization's developer, I want every Payment I create with my API Key to belong to my Organization automatically, so that I never send an Organization in the request.
72. As an Organization's developer, I want a request with a missing, unknown or revoked API Key to be refused, so that only my system can act for my Organization.
73. As an Organization's developer, I want my API Key to be refused while my Organization is suspended, so that suspension is enforced.
74. As an Organization's developer, I want to be unable to read or act on another Organization's Payment with my key, so that a bug in my system cannot touch other businesses.

### Gateway Connections

75. As an Organization Admin, I want to connect my own account with a PaymentGateway by entering its credentials, so that money goes straight to my business.
76. As an Organization Admin, I want at most one Gateway Connection per PaymentGateway, so that it is always clear which account a gateway uses.
77. As an Organization Admin, I want saved credentials never to be shown again, only whether they are set, so that nobody can copy them from the Console.
78. As an Organization Admin, I want to replace a Gateway Connection's credentials, so that I can rotate my gateway secrets.
79. As an Organization Admin, I want to see the Callback URL for each Gateway Connection, so that I can configure it in the gateway's dashboard.
80. As an Organization Admin, I want to disable a Gateway Connection, so that my customers stop paying through that gateway.
81. As an Organization Admin, I want PaymentTransactions already under way on a disabled Gateway Connection to finish normally, with their Callbacks, re-queries, reconciliation and Refunds, so that disabling never strands a customer's payment.
82. As an Organization Admin, I want to enable a Gateway Connection again, so that I can resume a gateway.
83. As an Organization's developer, I want starting a PaymentTransaction on a gateway my Organization has not connected, or has disabled, to be refused with a clear error, so that I know to switch gateway.
84. As an Organization Admin, I want a Gateway Connection that has been used never to be deleted, so that past PaymentTransactions keep their credentials for Refunds and reconciliation.
85. As a PaymentGateway, I want to send Callbacks to a URL that names the Gateway Connection, so that PayBridge verifies them with the right Organization's secret.
86. As a platform engineer, I want a Callback with an invalid signature for that Gateway Connection to be refused as today, so that a forged Callback never changes a Payment.
87. As a platform engineer, I want credentials encrypted at rest with a key from configuration, with the key id stored per row, so that the key can be rotated and rows re-encrypted by a command.
88. As a platform engineer, I want the API to refuse to start in production without a credentials key, so that credentials are never stored unencrypted.
89. As a developer, I want the `fake` gateway's Gateway Connection to have no credentials and to exist only outside production, so that local work and tests still have a gateway.

### Migration and seed

90. As a platform engineer, I want existing Payments and everything under them moved into one default Organization, so that nothing is lost and no row is ownerless.
91. As a platform engineer, I want a one-off command that copies the env-configured Stripe account into the default Organization's Gateway Connection, so that Stripe keeps working after the switch.
92. As a platform engineer, I want the old Callback URL to keep working for the default Organization until the Stripe dashboard is updated, so that no Callback is lost during the migration.
93. As a developer, I want the seed to create its scenarios inside at least two Organizations, so that isolation is visible in the Console.
94. As a developer, I want the seed to create a Super Admin, Organization Admins and Operators that all share one fixed development password, so that I can sign in as every Role.
95. As a developer, I want the seed to include a suspended Organization, a deactivated User, a pending Invitation, API Keys and a disabled Gateway Connection, so that every new screen has data.

### Console

96. As a User, I want a sign-in page, a forgot-password page, an accept-Invitation page and a reset-password page, so that I can get in without help.
97. As an Organization Admin, I want settings pages for Users and Invitations, API Keys and Gateway Connections, so that I manage my Organization in one place.
98. As a Super Admin, I want a Platform area for Organizations and Super Admins, so that platform work is separate from Organization work.
99. As a User, I want to see who I am signed in as, my Role and my Organization, so that I always know whose data I am looking at.
100. As a User, I want the Console to take me back to sign-in when my tokens can no longer be refreshed, so that an expired sign-in never leaves the Console broken.

## Implementation Decisions

- **New `identity` module.** Organizations, Users, Invitations, Password Resets, refresh tokens and API Keys live in a new API module that owns the `iam_` table prefix (ADR 0001, ADR 0005). Its layout mirrors Payment Core:
  - a framework-free domain (entities and rules such as "keep one active Organization Admin");
  - application use-cases;
  - ports, for example the email sender and the password hasher;
  - infrastructure adapters (Prisma repositories, the console-log email adapter);
  - HTTP controllers.

  It gets the same boundary checks: only its Prisma adapter imports the database client, and one transaction runner opens transactions. Payment Core never reads `iam_` tables.
- **Principal.** Every authenticated request carries a principal: either a User (id, Role, Organization or none, Permissions) taken from a verified access token, or an API Key (id, Organization). Payment Core receives the principal and derives the Organization scope from it, never from a body or query parameter. A Super Admin's scope is either one chosen Organization or "all Organizations" for reads. Every write requires one Organization.
- **Permissions.** A fixed map from each Role to its Permissions is defined in code in the `identity` module. Checks name a Permission. The minimum set covers: view Payment data; resolve Review; manage Users; manage API Keys; manage Gateway Connections; manage Organizations; manage Super Admins. Organization Admin is a superset of Operator, and Super Admin holds every Permission in every Organization.
- **Sensitive writes.** Resolving a Review and every management action (Users, Invitations, API Keys, Gateway Connections, Organizations, Super Admins) are sensitive. Before acting, each one re-reads the User's active state and current Role and the Organization's suspension state from the database. Every new write endpoint must be classified explicitly.
- **Tokens (ADR 0008).**
  - **Access token:** a JWT signed with ES256, lifetime 5 minutes. Its claims are User, Role, Organization (absent for Super Admins) and Permissions. Public keys are published as a JWKS.
  - **Refresh token:** random, at most 7 days, 24 hours idle. Stored hashed, rotated on every use, organised in families. A reused token revokes its family.
  - **Revocation:** deactivation, a Role change, a password change, a Password Reset or an Organization suspension revokes the affected refresh tokens.
- **BFF.** The Console's BFF replaces its current-operator seam with the signed-in User. It holds both tokens in httpOnly cookies and forwards the access token to the API. It refreshes on expiry, never returns a token to the browser, and keeps stripping upstream `set-cookie` (ADR 0004). The `actor` stamp on writes is replaced by the principal the API derives from the token. The BFF's allowed methods grow to cover the new non-`POST` writes (for example `PATCH` and `DELETE`).
- **Sign-in and accounts.**
  - Email and password only, with no public sign-up. Passwords are hashed with argon2id and have at least 12 characters.
  - A wrong email and a wrong password return the same error.
  - An email address belongs to at most one User.
- **Invitations.** Each carries an email, a Role and an Organization (none for a Super Admin). They are single-use, expire after 7 days and are stored hashed. Re-sending voids the previous link. Super Admins invite an Organization's first Organization Admin and other Super Admins; Organization Admins invite Operators and Organization Admins in their own Organization.
- **Password Reset.** Single-use, 30 minutes, stored hashed. A request for an unknown email gets the same response and sends nothing. Completing a reset revokes all of the User's refresh tokens.
- **User management rules.**
  - At least one active Organization Admin per Organization, and at least one active Super Admin on the platform. A Super Admin cannot change Role, only be deactivated.
  - A Super Admin can appoint an Organization Admin in any Organization.
  - A CLI command creates a Super Admin at any time.
- **Email port.** One port sends an email given a recipient, a subject, a body and the action link. In development and tests the adapter writes the recipient, subject and full link to the console log. Tests swap in a recording adapter through dependency injection, as tests already do for the Stripe HTTP client. A real provider is a later adapter.
- **Organizations.** An Organization has a name, an active or suspended state and timestamps, and is never deleted. Suspension:
  - refuses its API Keys and its Users' sign-ins, refreshes and sensitive writes;
  - still processes Callbacks, re-queries, reconciliation and expiry for attempts already under way.
- **Schema changes in Payment Core.**
  - Every `core_*` table that holds Organization data gains a non-null `organization_id`, a foreign key to the Organizations table: Payments, PaymentTransactions, Refunds, idempotency keys, Payment Events, Callbacks and status transitions.
  - The Upstream Reference's unique key becomes Organization plus Upstream Reference.
  - Existing indexes used by the operator lists gain the Organization as their leading column where the query filters by it.
  - Status transitions record the acting User's id and the Role they held. Super Admin actions are labelled as the platform's in operator read models.
- **Isolation (ADR 0006).** Every Payment Core repository method that reads or writes Organization data takes an explicit Organization scope; "all Organizations" exists only on read models and only for Super Admins. There is no Postgres RLS.
- **API Keys.** An API Key belongs to one Organization and has a label, a recognisable prefix (for example `pb_live_…`), a hash, a created time, a last-used time and a revoked time. The full key is returned once, at creation. The public payments API authenticates by API Key and takes the Organization from it. An Organization may hold several active keys.
- **Gateway Connections (ADR 0007).**
  - **Storage and identity.** Owned by Payment Core in a new `core_` table: Organization, gateway identifier, encrypted credentials, the encrypting key's id, a credentials version, and enabled or disabled. At most one per Organization per gateway, and never deleted once used.
  - **Plugin factory.** Each Gateway Plugin now registers a factory that builds an instance from one Gateway Connection's credentials. The Gateway Manager builds and caches instances per Gateway Connection id and credentials version, instead of receiving ready-built plugins with credentials from env.
  - **Disabled connections.** Starting a PaymentTransaction requires an enabled Gateway Connection for that gateway in the Payment's Organization. Callbacks, re-queries, reconciliation and Refunds work for disabled connections.
  - **Encryption.** AES-256-GCM with keys from a configuration variable holding several identified keys. A CLI command re-encrypts every row under the primary key. Production refuses to start without one.
  - **Visibility.** Credentials are never returned by any endpoint; responses say only which fields are set.
  - **The `fake` gateway.** Its Gateway Connection has no credentials and is available outside production only.
- **Callback URL.**
  - Callbacks arrive at the webhooks route with the gateway identifier followed by the Gateway Connection's id. Intake resolves the Gateway Connection first, then verifies with its plugin instance. The Gateway Connection's Organization is stored with the Callback.
  - The existing route without a connection id forwards to the default Organization's Stripe Gateway Connection during migration, and is removed afterwards together with the `STRIPE_*` variables.
  - The Console's Gateways view shows the per-connection Callback URL built from the public base URL.
- **Migration.**
  - One migration creates the default Organization, backfills `organization_id` on every existing row, then sets it non-null and swaps the unique key.
  - A one-off CLI command copies the env Stripe account into the default Organization's Gateway Connection.
- **Seed.** The seed creates at least two Organizations with its existing scenarios split between them. It also creates:
  - a Super Admin, Organization Admins and Operators that all share one fixed development password;
  - a suspended Organization, a deactivated User and a pending Invitation;
  - API Keys and Gateway Connections, one of them disabled.

  It keeps its current safety checks, and its own rows stay recognisable so a re-run replaces only them.
- **Console.**
  - New pages: sign-in, forgot password, accept Invitation and reset password.
  - Organization settings: Users and Invitations, API Keys, Gateway Connections.
  - For Super Admins: a Platform area (Organizations, Super Admins) and an Organization switcher with an "All Organizations" read view.
  - Everywhere: the signed-in User, Role and Organization are shown; actions the User has no Permission for are hidden or disabled; history shows Super Admin actions labelled as the platform's.

## Testing Decisions

- **What makes a good test.** It asserts external behaviour only: status codes, response bodies, what a User can and cannot see or change, what email was sent with which link, and what the Console's BFF puts in cookies and forwards. It never reaches into repositories, token internals, hash formats or query builders. Each rule is tested where a caller observes it.
- **Seam 1: HTTP into the in-process Nest app over real PostgreSQL (primary).** This is the existing integration-test harness. It grows helpers to sign in as any Role in any Organization, and to call the payments API with an API Key. Almost everything is tested here:
  - sign-in, refresh, rotation, reuse detection and sign-out;
  - Invitations (send, accept, expire, re-send, revoke, duplicate email);
  - Password Reset (known and unknown email, single use, expiry, revocation of other tokens);
  - every Permission per Role, including refusals;
  - immediate refusal of sensitive writes after deactivation, a Role change or a suspension;
  - the last-Organization-Admin and last-Super-Admin guards;
  - isolation: a User or API Key of one Organization gets not-found for another Organization's Payment, Review, Callback, Payment Event and audit rows, and lists never include them;
  - a Super Admin's cross-Organization reads, and refusal of writes without one chosen Organization;
  - API Key creation, one-time display, revocation and suspension;
  - Gateway Connections: credentials never returned, one per gateway, enable and disable, start refused when disabled, Callbacks and re-queries still working when disabled, the per-connection Callback URL verifying with the right secret, the legacy route during migration;
  - the backfill migration and the Stripe import command;
  - the seed's new contents.

  The existing operator contract tests keep validating responses against the copied Console schemas.
- **Seam 2: the email port, injected into seam 1.** Tests replace the console-log adapter with a recording adapter, read the Invitation or Password Reset link from the recorded email, and continue over HTTP. The console-log adapter itself gets one small test that it logs recipient, subject and link.
- **Seam 3: the Console BFF's existing unit tests.** They cover:
  - cookies are httpOnly and never returned to the browser;
  - the access token is forwarded to the API;
  - refresh on expiry;
  - redirect to sign-in when refresh fails;
  - upstream `set-cookie` is still stripped;
  - the new methods are allowed.

  These are needed because the tokens live in the BFF, outside the API.
- **Seam 4: static boundary specs.**
  - The `identity` module gets the same checks Payment Core has: database client only in the Prisma adapter, one transaction runner.
  - A new isolation spec (ADR 0006) checks that every Payment Core repository method touching Organization data takes an Organization scope.
- **Prior art.**
  - The HTTP integration tests that boot the Nest app over real PostgreSQL (attempts, create-payment, browser-return, review-resolution, webhook-intake), and the shared test-database and reset helpers.
  - The operator contract tests and their console-app harness.
  - The Stripe HTTP client override pattern for injecting test adapters.
  - The seed integration test.
  - Payment Core's architecture and boundary specs.
  - The BFF proxy and current-operator unit tests.
  - The Console's Playwright suite on mocks, which gains specs for sign-in, settings and the Platform area on mocks only.
- **CI.** All of this runs in the existing unit and integration test commands with the Postgres and Redis services CI already provides. No job starts a real API server.
- **Not tested separately.** Pure helpers (token signing, hashing, the Role-to-Permission map, encryption) are exercised through the HTTP seam, not unit-tested in isolation. The exception is key rotation for credentials, which is tested through its CLI command's observable result.

## Out of Scope

- One User belonging to several Organizations (memberships), and switching between them as a non-Super Admin.
- Custom Roles, or per-User Permission overrides.
- SSO, OIDC and MFA.
- Impersonation, beyond a Super Admin acting with their own identity.
- A real email provider. Only the console-log adapter is built.
- Webhooks out to Organizations. Payment Events still have no outbound delivery.
- PayBridge holding funds or paying Organizations out (ADR 0007).
- Postgres row-level security (ADR 0006).
- KMS-managed encryption keys.
- Self-service sign-up and billing for Organizations.
- Rate limiting of sign-in and Password Reset beyond what exists today.
- Deleting Organizations or used Gateway Connections.

## Further Notes

- **Biggest change.** The Gateway Manager and plugin factory change is the largest edit to existing code: plugins stop reading env-built credentials. Do it in a tracer slice that keeps the `fake` gateway green before Stripe moves.
- **Data movement.** The backfill migration and the Stripe import are the only steps that touch existing data. Run them against a copy of a real database before production. The legacy Callback route must stay until the Stripe dashboard points at the new per-connection URL.
- **Read delay.** Reads can lag a revocation by up to 5 minutes by design (ADR 0008). Reviewers should reject any change that drops the database check from a sensitive write.
- **Suggested delivery order, as vertical slices** (see the [map](map.md)):
  1. Organizations in the schema, with the default Organization, scoped repositories, the isolation spec and the seed in two Organizations.
  2. The email port and console-log adapter.
  3. Users, sign-in and tokens, with the first Super Admin by CLI and the BFF holding the tokens.
  4. Permissions and sensitive writes.
  5. Invitations.
  6. Password Reset.
  7. User management.
  8. API Keys.
  9. Gateway Connections and the per-connection Callback URL.
  10. The Platform area and Organization switcher.
