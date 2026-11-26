Status: ready-for-agent

# Spec: Embedded Checkout with Pricing Plans and Webhooks

Source: [Map: Embedded Checkout with Pricing Plans and Webhooks](map.md), settled by grilling on 2026-11-26. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Architecture decisions: [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md), [ADR 0002](../../docs/adr/0002-postgresql-source-of-truth-bullmq-dispatch.md), [ADR 0003](../../docs/adr/0003-stripe-via-paymentintent-not-checkout.md), [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md), [ADR 0005](../../docs/adr/0005-operator-read-models-live-in-payment-core.md), [ADR 0006](../../docs/adr/0006-organization-isolation-enforced-in-the-application.md), [ADR 0007](../../docs/adr/0007-organizations-bring-their-own-gateway-accounts.md) and [ADR 0009](../../docs/adr/0009-browser-starts-payments-with-a-publishable-key.md).

## Problem Statement

An Organization can collect money through PayBridge only by writing server code:

- **Server code required.** A Payment can be created only by the Organization's own system calling the payments API with an API Key, and that system must then drive the PaymentTransaction and show the customer its NextAction (a redirect, a QR code, or Stripe.js).
- **Nothing to sell from.** There is no notion of what the Organization sells. A business that just wants a "Buy the Pro plan" button on its landing page has to build pricing, checkout UI and gateway handling itself.
- **No way to learn the outcome.** Core already records a Payment Event whenever a Payment succeeds, is cancelled, expires or needs review, but nothing delivers those events to the Organization. Its system must poll each Payment to learn whether money arrived. If the customer closes the browser after paying by QR, the Organization may never find out.

## Solution

Let an Organization sell **Pricing Plans** from any web page by pasting a snippet, and tell its system about the result through **Webhooks**.

- **Pricing Plans in the Console.** An Organization Admin defines Pricing Plans with a name, a description, a list of features, an Amount in VND, the PaymentGateways allowed, return URLs and a Payment Expiry. A Pricing Plan is paid once.
- **Pricing Tables.** The Organization Admin groups one to three Pricing Plans into a Pricing Table with a simple look (main colour, light or dark, Vietnamese or English, button text) and can mark one Pricing Plan as recommended.
- **Embedded Checkout.** The Console gives a snippet that loads one shared, versioned PayBridge script with a Publishable Key and a Pricing Table. The script draws the price cards on the host page. When a Customer picks a Pricing Plan, a checkout window served by PayBridge opens in an iframe. There the Customer chooses a PaymentGateway and pays by redirect, QR code or Stripe.js, without the host page ever seeing the payment details. Changing the Pricing Table or its Pricing Plans in the Console changes every page that embeds it.
- **Publishable Keys.** The browser starts Payments with a public Publishable Key instead of an API Key (ADR 0009). It works only from the Organization's allowed websites, only for that Organization's Pricing Plans, and is rate-limited. The Amount always comes from the Pricing Plan on the server.
- **Knowing who bought.** The Organization tells the checkout who the Customer is with a Customer Reference (its own user id in the snippet), or the checkout asks the Customer for an email, or both.
- **Webhooks.** An Organization Admin registers Webhook Endpoints. PayBridge delivers every Payment Event (for every Payment, not only checkout ones) to them, signed, at least once, and retries for about three days. Operators can see every delivery and resend one. Browser events and redirects exist only to update the page; the Webhook is what the Organization trusts.

## User Stories

### Pricing Plans

1. As an Organization Admin, I want to create a Pricing Plan with a name, a description and an Amount in VND, so that I can sell it without writing code.
2. As an Organization Admin, I want to add a list of features to a Pricing Plan, each marked as included or not included, so that Customers can compare Pricing Plans at a glance.
3. As an Organization Admin, I want feature lines to be plain text only, so that nothing I type can run as code on a page.
4. As an Organization Admin, I want to limit a Pricing Plan to some of my enabled PaymentGateways, so that I can, for example, accept only domestic gateways for a cheap plan.
5. As an Organization Admin, I want a Pricing Plan with no gateway limit to offer every PaymentGateway I have enabled, so that I do not have to update it when I enable a new one.
6. As an Organization Admin, I want to set a success URL and a cancel URL on a Pricing Plan, so that Customers land on the right page after paying or giving up.
7. As an Organization Admin, I want to set the Payment Expiry of a Pricing Plan within the allowed range, so that slow payment methods have enough time and abandoned ones close quickly.
8. As an Organization Admin, I want a new Pricing Plan to get a sensible default Payment Expiry, so that I do not have to think about it.
9. As an Organization Admin, I want to edit a Pricing Plan's name, description, features, Amount and settings at any time, so that I can adjust my offer.
10. As an Organization Admin, I want changing a Pricing Plan's Amount never to change Payments already created from it, so that a Customer is never asked to pay a different amount mid-checkout.
11. As an Organization Admin, I want to archive a Pricing Plan, so that it can no longer be bought while its Payments keep their history.
12. As an Organization Admin, I want to be told which Pricing Tables show a Pricing Plan before I archive it, so that I know which pages will be affected.
13. As an Organization Admin, I want a Pricing Plan that has Payments never to be deleted, so that every Payment keeps knowing what was bought.
14. As an Organization Admin, I want to delete a Pricing Plan that has never been paid for, so that mistakes do not clutter my list.
15. As an Organization Admin, I want to restore an archived Pricing Plan, so that I can sell it again.
16. As an Operator, I want to see my Organization's Pricing Plans, so that I can understand what a Customer bought when I investigate a Payment.
17. As an Operator, I want to be refused when I try to create, edit or archive a Pricing Plan, so that pricing stays with the people responsible for it.

### Pricing Tables

18. As an Organization Admin, I want to create a Pricing Table with one to three of my Pricing Plans in an order I choose, so that I can show a typical pricing section.
19. As an Organization Admin, I want to mark one Pricing Plan in a Pricing Table as recommended, so that Customers are steered toward it.
20. As an Organization Admin, I want to choose a Pricing Table's main colour, light or dark theme, language (Vietnamese or English) and button text, so that it fits my website.
21. As an Organization Admin, I want to use the same Pricing Plan in several Pricing Tables, so that my home page and a promotion page can both sell it.
22. As an Organization Admin, I want changes to a Pricing Table to show on every page that embeds it without pasting the snippet again, so that I manage my pricing in one place.
23. As an Organization Admin, I want to delete a Pricing Table, so that I can remove pricing I no longer use.
24. As an Organization Admin, I want a deleted Pricing Table to show as unavailable on pages that still embed it, so that those pages do not break.
25. As an Organization Admin, I want to copy a ready-made snippet for a Pricing Table and a Publishable Key from the Console, so that embedding is copy and paste.
26. As an Organization Admin, I want a preview of a Pricing Table in the Console, so that I can see it before I publish the snippet.
27. As an Operator, I want to see my Organization's Pricing Tables but not change them, so that I can support Customers who mention a page.

### Publishable Keys

28. As an Organization Admin, I want to create a Publishable Key, so that my web pages can start Payments.
29. As an Organization Admin, I want to give each Publishable Key the list of websites allowed to embed it, so that nobody can copy my snippet onto another site and sell my Pricing Plans there.
30. As an Organization Admin, I want a Publishable Key without allowed websites to be refused, so that I cannot accidentally create one that works everywhere.
31. As an Organization Admin, I want to hold several Publishable Keys at once and revoke any of them, so that I can rotate keys without downtime.
32. As an Organization Admin, I want the Publishable Key to be visible in the Console at any time, so that I can copy the snippet again; it is not secret.
33. As an Organization Admin, I want a Publishable Key to be unable to do anything except show my Pricing Tables and start Payments for my Pricing Plans, so that publishing it in my page source is safe.
34. As an Organization Admin, I want my API Keys never to be accepted where a Publishable Key is expected, and the reverse, so that a secret key is never pasted into a page by mistake and a public key never reaches my payments API.
35. As an Organization Admin, I want the number of Payments started with one Publishable Key, and from one IP address, to be limited, so that a script cannot flood my account with Payments.
36. As an Operator, I want to be refused when I try to create or revoke a Publishable Key, so that credentials stay with the people responsible for them.

### Embedded Checkout: on the host page

37. As an Organization's developer, I want to embed pricing by pasting one script tag with a Publishable Key and a Pricing Table, so that I need no build step and no server code.
38. As an Organization's developer, I want the script to load from one versioned PayBridge address, so that fixes reach my page without my doing anything and I can pin a version if I want.
39. As an Organization's developer, I want to pass my own user id as a Customer Reference in the snippet, so that I know whom a purchase is for when its Webhook arrives.
40. As an Organization's developer, I want the snippet's Customer Reference to apply to whichever Pricing Plan the Customer picks in the Pricing Table, so that I set it once.
41. As an Organization's developer, I want to turn on asking the Customer for an email, so that a static landing page without sign-in can still tell me who bought.
42. As an Organization's developer, I want optional success, cancel and error callbacks from the script, so that a single-page app can update itself without a redirect.
43. As an Organization's developer, I want the documentation to say plainly that browser callbacks must never unlock a purchase, so that I rely on Webhooks for that.
44. As an Organization's developer, I want the snippet's own success and cancel URLs to override the Pricing Plan's, so that one Pricing Plan can return to different pages.
45. As an Organization's developer, I want the price cards to draw inside my page without my page's styles breaking them, so that the pricing looks the same everywhere.
46. As an Organization's developer, I want a clear message in the browser console when the snippet cannot work (unknown key, revoked key, website not allowed, unknown Pricing Table, Organization suspended, no gateway enabled), so that I can fix my setup.

### Embedded Checkout: for the Customer

47. As a Customer, I want to see each Pricing Plan's name, price, description and features side by side, so that I can choose.
48. As a Customer, I want to see which Pricing Plan is recommended, so that I can choose quickly.
49. As a Customer, I want to pay in a window that belongs to PayBridge, so that the page I am on cannot read or change my payment details or swap the QR code.
50. As a Customer, I want to choose among the PaymentGateways the Pricing Plan allows, so that I can pay the way I prefer.
51. As a Customer, I want to be sent to the gateway's page when it requires a redirect, so that I can pay with VNPay and similar gateways.
52. As a Customer, I want to see a QR code when the gateway offers one, so that I can pay from my banking app.
53. As a Customer, I want to enter my card in Stripe's own form when I choose Stripe, so that my card details go only to Stripe (ADR 0003).
54. As a Customer, I want the window to notice by itself when my QR payment is done, so that I do not have to click anything after paying on my phone.
55. As a Customer, I want to be asked for my email when the Organization asks for it, so that the Organization can deliver what I bought.
56. As a Customer, I want clicking "Buy" twice, or closing and reopening the window, to continue the same Payment while it is still open, so that I never pay twice for one purchase.
57. As a Customer, I want a new Payment to start when the previous one has expired, so that I can still buy after a long pause.
58. As a Customer, I want to switch PaymentGateway after a failed or abandoned attempt, so that I can try another way to pay for the same purchase.
59. As a Customer, I want to see a clear result after paying, giving up, or running out of time, so that I know what happened.
60. As a Customer returning from a gateway's page, I want to land on a PayBridge page that shows my result and then takes me to the Organization's success or cancel page, so that I end up back on the Organization's site.
61. As a Customer returning when no success or cancel URL is set, I want to be taken back to the page I started from, so that I am not stranded.
62. As a Customer, I want a Pricing Plan that cannot be bought right now to say "Payment is not available right now" without technical details, so that I am not confused.
63. As a Customer, I want the checkout in the Pricing Table's language, so that I can understand it.

### Starting Payments from the Embedded Checkout

64. As an Organization, I want a Payment started from the Embedded Checkout to take its Amount from the Pricing Plan on the server, so that nobody can change the price in the browser.
65. As an Organization, I want such a Payment to record which Pricing Plan it was for and that Pricing Plan's name at that moment, so that renaming a Pricing Plan later never confuses my records.
66. As an Organization, I want such a Payment to carry its Customer Reference, so that I can match it to my user.
67. As an Organization, I want PayBridge to assign the Upstream Reference of such a Payment, so that it still has one although none of my systems took part.
68. As an Organization, I want such a Payment's Payment Expiry to come from its Pricing Plan, so that I control how long Customers have.
69. As an Organization, I want no Payment to be started for an archived Pricing Plan, a suspended Organization, a revoked Publishable Key, a website that is not allowed, or a PaymentGateway that is not allowed or not enabled, so that I only sell what I intend to.
70. As an Organization, I want Payments from the Embedded Checkout to behave like every other Payment (Reviews, expiry, Late Success, Callbacks, Refunds), so that I operate them the same way.
71. As an Operator, I want to see on a Payment's detail that it came from the Embedded Checkout, with its Pricing Plan and Customer Reference, so that I can answer a Customer who says they paid.
72. As an Operator, I want to filter Payments by Pricing Plan, so that I can see what each Pricing Plan sold.

### Webhook Endpoints

73. As an Organization Admin, I want to register a Webhook Endpoint with an HTTPS URL, so that my system receives Payment Events.
74. As an Organization Admin, I want to choose which kinds of Payment Event each Webhook Endpoint receives, so that each of my systems gets only what it needs.
75. As an Organization Admin, I want several Webhook Endpoints, so that different systems, or an old and a new one during a migration, can each receive events.
76. As an Organization Admin, I want each Webhook Endpoint to have its own signing secret, shown in full once and then only by its prefix, so that I can verify deliveries and a leak affects only one endpoint.
77. As an Organization Admin, I want to roll a Webhook Endpoint's signing secret with the old one still valid for a while, so that I can update my system without missing deliveries.
78. As an Organization Admin, I want to disable, enable and delete a Webhook Endpoint, so that I can stop deliveries to a system I am retiring.
79. As an Organization Admin, I want to send a test event to a Webhook Endpoint, so that I can check my receiver before real money arrives.
80. As an Operator, I want to be refused when I try to create, change or delete a Webhook Endpoint, so that delivery settings stay with the people responsible for them.

### Webhook delivery

81. As an Organization's developer, I want every Payment Event of my Organization delivered to my Webhook Endpoints, whether the Payment came from my API or the Embedded Checkout, so that I have one way to learn outcomes.
82. As an Organization's developer, I want every delivery signed with my endpoint's secret and a timestamp, so that I can reject forged or replayed requests.
83. As an Organization's developer, I want every Payment Event to have a stable id, so that I can ignore duplicates, because a delivery may arrive more than once.
84. As an Organization's developer, I want each delivery to say when the event happened, so that I can handle events that arrive out of order.
85. As an Organization's developer, I want a delivery to include the Payment's id, status, Amount, Upstream Reference and, for checkout Payments, the Pricing Plan id, its name at purchase and the Customer Reference, so that I can act without another API call.
86. As an Organization's developer, I want a delivery that does not get a 2xx answer within a short timeout to be retried with growing delays for about three days, so that an outage on my side does not lose events.
87. As an Organization's developer, I want a delivery that still fails after the last retry to be marked as failed, so that it is visible rather than silently lost.
88. As an Organization's developer, I want deliveries to keep working if PayBridge restarts or Redis is briefly unavailable, so that no Payment Event is skipped.
89. As an Organization's developer, I want to read a Payment with my API Key at any time, so that I can recover if I missed a Webhook.
90. As an Organization, I want my Webhooks never to go to another Organization, and theirs never to come to me, so that isolation holds for outbound events too.
91. As an Organization Admin, I want a Webhook Endpoint that keeps failing to show its failures clearly in the Console, so that I notice a broken receiver.

### Webhook deliveries in the Console

92. As an Operator, I want to see the deliveries of my Organization's Payment Events, with each attempt's time, HTTP status and short response, so that I can tell a Customer whether their purchase was reported.
93. As an Operator, I want to see a Payment's deliveries from its detail page, so that I can investigate one purchase quickly.
94. As an Operator, I want to filter deliveries by Webhook Endpoint, status and kind of event, so that I can find problems.
95. As an Operator, I want to resend a delivery, so that I can fix a missed purchase once the Organization's receiver is working again.
96. As an Operator, I want every resend recorded with my identity, so that the audit log shows who resent what.

### Platform

97. As a Super Admin, I want to manage any Organization's Pricing Plans, Pricing Tables, Publishable Keys and Webhook Endpoints, so that I can support it; my changes are shown as done by the platform.
98. As a Super Admin, I want a suspended Organization's Embedded Checkouts to show as unavailable while Webhooks for its Payments already under way keep being delivered, so that money already paid is still reported.
99. As a developer of PayBridge, I want the seed to create Pricing Plans, a Pricing Table, a Publishable Key and a Webhook Endpoint pointing at a local test receiver, so that the whole flow can be tried locally with the fake gateway.

## Implementation Decisions

### Modules and ownership

- **Checkout module (new, API).** It owns Pricing Plans and Pricing Tables, and the public endpoints the SDK and checkout page call. It has its own table prefix (ADR 0001) and its own folders by layer, like Payment Core and identity. It starts Payments only through Payment Core's public port and never touches `core_` tables.
- **Publishable Keys live in the identity module**, next to API Keys. They are credentials, and identity already authenticates callers. Identity resolves a Publishable Key into a principal with the Organization and a "checkout only" kind. That principal is accepted only by the checkout endpoints, and an API Key principal is refused there. Both directions are tested.
- **Webhooks module (new, API).** It owns Webhook Endpoints, deliveries and delivery attempts, with its own table prefix. It consumes the existing `core-outbox` queue, which the outbox relay already fills but nothing consumes yet. Payment Core does not know it exists. It reads the Payment Event payload from the queue job, or reads Payment Events through Payment Core's public port; it never queries `core_` tables directly.
- **Payment Core changes:**
  - **Create Payment** accepts an optional checkout origin: the Pricing Plan id, the Pricing Plan name at that moment, and the Customer Reference (an opaque id, an email, or both). These are stored on the Payment and copied into its Payment Events' payload.
  - **Upstream Reference.** When the caller is the Embedded Checkout, Core generates the Upstream Reference with a recognisable prefix, keeping uniqueness within the Organization.
  - **Payment Expiry** stays within today's range (30 minutes to 24 hours, default 30 minutes). A Pricing Plan's Payment Expiry is validated against the same range.
  - **Console read models** gain the checkout origin on Payment detail and a Pricing Plan filter on the Payments list (ADR 0005: Core owns its reads).
- **Checkout app (new, `apps/checkout`).** A public web app, separate from the Console, which sits behind sign-in and the BFF (ADR 0004). It serves:
  - the versioned SDK script, under a major-version path (for example `/v1/paybridge.js`) with exact-version paths for pinning;
  - the checkout page that runs inside the iframe;
  - the return page that gateways redirect to.

  It calls only the API's public checkout endpoints.
- **Console.** New pages for Pricing Plans, Pricing Tables (with preview and snippet), Publishable Keys, Webhook Endpoints and Webhook deliveries, all through the BFF (ADR 0004).

### Permissions

- New Permissions are defined in code and checked by Permission, never by Role name:
  - manage Pricing Plans and Pricing Tables;
  - manage Publishable Keys;
  - manage Webhook Endpoints;
  - view Pricing Plans and Pricing Tables;
  - view Webhook deliveries;
  - resend a Webhook delivery.
- Organization Admin gets all of them. Operator gets the view Permissions and resend. Super Admin gets all of them in every Organization, labelled as the platform.
- Every write is scoped to the principal's Organization (ADR 0006), and the isolation test covers every new repository.

### Pricing Plan

- **Fields:**
  - name and description;
  - features: an ordered list of `{ text, included }`, plain text, capped at about 10 lines, with HTML never rendered;
  - Amount: a decimal string in the major unit, VND only;
  - allowed PaymentGateway ids (empty means every enabled one);
  - success URL and cancel URL, which are optional and must be HTTPS outside development;
  - Payment Expiry duration;
  - status: active or archived.
- **Payments copy, they don't follow.** A Payment copies the Amount and the name when it is created. Edits to the Pricing Plan affect only Payments created afterwards.
- **Archive and delete.** Archiving is allowed always. Delete is allowed only when no Payment references the Pricing Plan. Archiving returns the Pricing Tables that include the Pricing Plan, so the Console can warn first.
- **One-time only.** There is no recurring interval field yet. It will come with subscriptions.

### Pricing Table

- Holds one to three Pricing Plan ids in order, an optional recommended Pricing Plan that must be one of them, a theme (main colour, light or dark, `vi` or `en`) and button text.
- The plans of a Pricing Table belong to its Organization. Adding another Organization's Pricing Plan behaves as if the Pricing Plan did not exist.
- An archived Pricing Plan stays in its Pricing Tables and shows as unavailable.
- A Pricing Table can be deleted outright.

### Publishable Key

- **Format.** A recognisable prefix (for example `pb_pk_…`) distinct from API Keys (`pb_live_…`). It is stored so that it can be shown again, because it is not secret.
- **Allowed origins.** Each key carries a list of allowed origins (scheme, host and port), with at least one required. `localhost` origins are accepted only outside production.
- **Origin enforcement:**
  - The checkout endpoints check the request `Origin`.
  - The checkout page in the iframe also receives the host page's origin from the SDK and checks it against the key.
  - The checkout app sends `Content-Security-Policy: frame-ancestors` with the key's allowed origins, so the iframe cannot be framed by another site.
- **Rate limits.** Starting Payments is rate-limited per Publishable Key and per client IP. The limits are configuration values.
- **Lifecycle.** Revoking a key makes it fail at once. An Organization can hold several keys.

### Public checkout endpoints (API)

All are authenticated by a Publishable Key and an allowed origin, and none uses cookies.

- **Read a Pricing Table for display.** Returns the theme and, for each Pricing Plan:
  - name, Amount, description and features;
  - whether it is recommended;
  - the PaymentGateways the Customer may choose (allowed and enabled);
  - whether it can be bought now.

  When nothing can be sold, it returns a generic unavailable response. The reason (archived, suspended, no gateway, revoked key, origin not allowed, unknown table) goes only into a machine-readable code meant for the developer console, not shown to the Customer.
- **Start or resume a checkout Payment.**
  - Input: Pricing Plan, Customer Reference and/or email, and a checkout session token that the SDK keeps in the browser.
  - If an open Payment exists for the same session token, Pricing Plan and Customer Reference, it is returned. Otherwise a new Payment is created through Payment Core with the Pricing Plan's Amount and Payment Expiry. The browser never sends an Amount.
- **Start an attempt** on that Payment with a chosen PaymentGateway. This reuses Core's start attempt and returns its NextAction. The chosen gateway must be allowed by the Pricing Plan and enabled.
- **Read the checkout Payment's status.** The checkout page polls it for QR and other asynchronous methods, and the result page reads it.
- **Errors.** They follow the existing domain-error mapping style, using one generic "unavailable" error for everything a Customer should not see the reason for.

### SDK and checkout page

- **The SDK script:**
  - reads `data-key`, `data-table`, the optional `data-customer-ref`, the optional `data-ask-email`, and the optional `data-success-url` and `data-cancel-url`;
  - fetches the Pricing Table;
  - draws the price cards inside a Shadow DOM so host styles do not leak in;
  - opens the checkout iframe in a modal when a Pricing Plan is picked.
- **Origin binding.** The SDK passes the host origin to the iframe. The iframe talks to the SDK only through `postMessage` with origin checks on both sides.
- **Browser callbacks.** The SDK exposes `onSuccess`, `onCancel` and `onError` callbacks (and matching DOM events) with the Payment id. They are for display only.
- **What the checkout page handles:**
  - email entry when it is asked for;
  - choosing a PaymentGateway;
  - all three NextAction kinds: redirect, QR, and client SDK, including loading Stripe.js with the `clientParams` from ADR 0003;
  - polling status;
  - showing the result in the Pricing Table's language.
- **Return after a redirect.** Gateways redirect back to the checkout app's return page, which reads the status and forwards the browser to the success or cancel URL. Snippet URLs override Pricing Plan URLs. With neither set, it returns to the host page the Customer started from.
- **Session token.** The checkout session token lives in the iframe's storage, scoped to the checkout app's origin. It is how "reopen the window, same Payment" works. If storage is unavailable, a new Payment is started each time, which is acceptable.

### Webhook Endpoint and delivery

- **Webhook Endpoint fields:**
  - URL, which must be HTTPS outside development;
  - the subscribed Payment Event kinds;
  - status: enabled or disabled;
  - a signing secret, stored encrypted and shown once at creation with a prefix afterwards;
  - an optional previous secret with an end time, kept during rotation.
- **Event kinds** map one to one to today's Payment Event types: `payment.created`, `payment.succeeded`, `payment.cancelled`, `payment.expired` and `payment.requires_review`, plus `webhook.test` for test sends. There is no `payment.failed` or refund kind yet, because Core emits no such Payment Event.
- **Payload.** A JSON envelope with:
  - the event id (the outbox event id, stable across retries and resends);
  - the event kind;
  - the time the event was created;
  - the Organization id;
  - a `data` object with the Payment: id, status, Amount, currency, Upstream Reference and Payment Expiry, plus the checkout origin when present (Pricing Plan id, Pricing Plan name at purchase, Customer Reference).
- **Signature.**
  - A header carries a timestamp and an HMAC-SHA256 of `timestamp + "." + raw body` under the endpoint's secret.
  - During rotation, it carries one signature per valid secret.
  - The documentation tells receivers to reject timestamps older than five minutes.
- **Fan-out.**
  - Consuming one outbox job creates one delivery per enabled Webhook Endpoint of that Organization that subscribes to the kind, idempotently per (event, endpoint).
  - Endpoints that are disabled when the event is consumed are skipped.
  - Only the event's own Organization's endpoints are considered.
- **Attempts.**
  - Each attempt is an HTTP POST with a short timeout, about 10 seconds.
  - A 2xx answer means success. Anything else, a timeout or a network error means failure.
  - Redirects are not followed.
  - Each attempt records time, HTTP status, duration and a truncated response body.
- **Retries.**
  - Retries use exponential backoff with jitter over about three days. Then the delivery is marked failed.
  - PostgreSQL is the source of truth for deliveries and BullMQ only dispatches (ADR 0002). A sweep re-enqueues deliveries that are due but lost from Redis, the same pattern as the webhook inbox sweep.
- **Resend and test send.** A resend (Operator or Admin) creates a new attempt on the same delivery with the same event id, and is recorded in the audit log. A test send creates a `webhook.test` delivery to one endpoint.
- **Outbound safety (SSRF).** A Webhook Endpoint must not let PayBridge's servers reach its own internal network or the cloud metadata service. This matters all the more because the Console shows part of each response body. In production every delivery:
  - resolves the host first and refuses private, loopback, link-local (including `169.254.169.254`), multicast and other reserved IPv4 and IPv6 ranges;
  - then connects to exactly the address it checked, so DNS rebinding cannot swap it;
  - never follows redirects;
  - uses HTTPS only.

  A refused address is recorded as a failed attempt with a clear reason, and the same check runs when the URL is saved. Development and tests allow localhost.
- **Retention.** Delivery records are kept for a configured period, matching the outbox retention, and pruned by the existing retention sweep pattern.

### Suspension and disabling

- **Suspended Organization:** checkout endpoints answer "unavailable", and Payments already under way finish normally. Deliveries for its Payment Events continue, as Callbacks do.
- **Disabled Gateway Connection:** that PaymentGateway disappears from checkout choices.

## Testing Decisions

- **What a good test is:**
  - It drives the system through its outermost public interface and asserts what an outside observer sees: HTTP responses, rows a Console reader would see, HTTP requests received by a Webhook receiver, and what a Customer sees in the browser.
  - It does not assert on internal calls, queue job shapes or private module state.
  - Time is driven with `FakeClock`, and gateways with the fake gateway.
- **Seam 1: API over HTTP** (supertest against the real application module, a migrated test database and the compose Redis). Covers:
  - Pricing Plan and Pricing Table management, with Permissions per Role and isolation between two Organizations;
  - Publishable Key management;
  - the public checkout endpoints: origin enforcement, revoked keys, an API Key refused at checkout and a Publishable Key refused at the payments API, rate limits, the Amount taken from the Pricing Plan, resuming an open Payment, a new Payment after expiry, gateway allow-lists, and suspended Organizations;
  - the checkout origin showing on Payment detail and filters;
  - Webhook Endpoint management.

  Prior art: `create-payment.int-spec.ts`, `browser-return.int-spec.ts`, `organization-isolation.int-spec.ts`, `identity/api-keys.int-spec.ts`, `identity/permissions.int-spec.ts` and the Console read specs under `test/payment-core/console/`, which use the contract schemas in `test/contract/console/`.
- **Seam 2: Webhook delivery over real HTTP.** The test starts a local HTTP receiver and points a Webhook Endpoint at it, then drives Payments through Core and asserts on what the receiver gets:
  - signature validity, including during secret rotation;
  - the payload contents for API and checkout Payments;
  - fan-out to several endpoints and subscription filtering;
  - no cross-Organization delivery;
  - retries on 500 responses and timeouts, advanced with `FakeClock`;
  - failure after the last retry;
  - recovery after a simulated Redis outage;
  - duplicate-safe ids on resend;
  - test sends.

  Prior art: `outbox-relay.int-spec.ts` (a local TCP proxy to simulate outages), `webhook-inbox-sweep.int-spec.ts` (sweep re-enqueuing).
- **Seam 3: Playwright.**
  - For the checkout app, a plain HTML host page served on an allowed origin embeds the snippet. Tests cover:
    - the price cards rendering with the theme;
    - buying with the fake gateway's redirect and QR flows;
    - `onSuccess` and the `success-url` redirect;
    - the cancel flow;
    - reopening the modal resuming the same Payment;
    - the unavailable state for an archived Pricing Plan;
    - a host page on a non-allowed origin being refused.
  - For the Console, the new pages follow the existing e2e specs (`gateways.spec.ts`, `platform.spec.ts`).
- **Unit tests** only where a pure rule is worth isolating: backoff schedule, signature computation and verification helpers, Pricing Table validation (one to three plans, recommended one among them). This follows `apply-provider-outcome.spec.ts` and `payment-expiry` style.
- **Architecture tests:** the existing boundary checks extend to the new modules. Checkout and Webhooks import Payment Core and identity only through their public ports, only their own `infrastructure/prisma/` imports the database client, and the isolation test covers their repositories.

## Out of Scope

- Subscriptions and recurring billing: billing intervals, saved payment methods, renewals, dunning, cancellation of a plan.
- Pricing Tables with more than three Pricing Plans, monthly/yearly toggles, free trials, coupons, discounts, taxes and quantities.
- Custom CSS or arbitrary HTML in Pricing Tables or features.
- Currencies other than VND.
- Receipts, invoices or any email to Customers.
- Customer accounts or sign-in in PayBridge.
- Refund Payment Events and `refund.*` and `payment.failed` Webhook kinds, until Core emits such Payment Events.
- Ordering guarantees for Webhooks.
- A hosted payment link (a PayBridge URL with no host page).
- Analytics on Pricing Tables (views, conversion).

## Further Notes

- **Order of work.** Webhooks have no dependency on the checkout and are what makes the checkout trustworthy, so they should be built first. Then Pricing Plans, Publishable Keys and the checkout endpoints, then Pricing Tables and the checkout app.
- **New table prefixes.** The checkout and webhooks modules each need a prefix registered with the schema guard (ADR 0001).
- **Gateway return URLs.** Start attempt already takes a caller-supplied return URL, so checkout attempts simply pass the checkout app's return page. Core needs no change for this.
- **ADR candidates.** If the implementation finds that Webhooks need ordering guarantees or exactly-once delivery, that would reverse a decision here and should be written as an ADR.
