# PayBridge

Payment platform that manages the lifecycle of payment collection and refunds independently of external payment service providers.

## Language

**Payment**:
A request to collect a specific monetary amount for an upstream order or obligation, independent of which PaymentGateway fulfills it. A single Payment may undergo multiple PaymentTransactions before succeeding or terminating.
_Avoid_: Transaction, Order, Invoice

**PaymentTransaction**:
A single attempt to collect funds for a Payment through a specific PaymentGateway, carrying its own attempt-level lifecycle and external provider reference.
_Avoid_: Payment, Order, Charge

**PaymentGateway**:
An external payment service provider (such as VNPay, ZaloPay, or Stripe) that processes PaymentTransactions and refunds.
_Avoid_: Bank, Payment Method

**Test Gateway**:
A PaymentGateway that PayBridge itself provides in Test Mode only. It moves no money: the Customer is sent to a PayBridge page where whoever is testing chooses how the PaymentTransaction ends (paid, declined, left pending, paid a different Amount, or paid late), and PayBridge then receives a Callback exactly as from a real PaymentGateway. The Organization's system can make the same choice with a Test API Key. Every Organization has a Gateway Connection to the Test Gateway from the start, with no credentials to enter.
_Avoid_: Fake gateway, Simulator, Mock gateway

**Gateway Plugin**:
The implementation of the gateway contract for one PaymentGateway. Core never depends on a Gateway Plugin; the application registers each one at startup.
_Avoid_: Adapter, Connector

**Gateway Manager**:
The component that finds the Gateway Plugin for a PaymentTransaction from its gateway identifier.
_Avoid_: Gateway Registry, Provider Factory

**NextAction**:
What the customer must do next to complete a PaymentTransaction: follow a redirect, scan a QR code, use a client SDK, or pay a voucher.
_Avoid_: Redirect URL, Payment Link

**Amount**:
The money a Payment asks to collect, expressed as a decimal amount in the currency's major unit (for VND, whole dong) together with its currency. In Phase 1 the currency is always VND.
_Avoid_: Price, Total

**Customer**:
The person who pays a Payment. A Customer is never a User and has no sign-in in PayBridge.
_Avoid_: User, Buyer, Payer, End user

**Pricing Plan**:
A named offer an Organization sells for a fixed Amount, set up in the Console with a description and a list of what it includes to show Customers. A Payment created from a Pricing Plan copies its Amount at that moment, so later changes to the Pricing Plan never touch Payments already created. A Pricing Plan that has Payments is archived, never deleted. A Pricing Plan sets the Payment Expiry of Payments started from it, and may limit which of the Organization's enabled PaymentGateways a Customer can choose. For now a Pricing Plan is paid once; it is not a subscription. A Pricing Plan belongs to one Mode. A Test Pricing Plan can be copied into Live; the copy is a separate Pricing Plan that later changes to either never reach.
_Avoid_: Product, Package, Price, Subscription

**Publishable Key**:
The public key an Organization puts in its web pages so that Customers' browsers can start Payments for that Organization's Pricing Plans. Unlike an API Key it is not secret, so it can do nothing else. Each Publishable Key belongs to one Mode, and the Payments it starts are in that Mode. A Test Publishable Key may also work on a developer's own machine; a Live one works only on secure websites.
_Avoid_: Public API Key, Client key, Embed token

**Embedded Checkout**:
The checkout an Organization puts on its own web page by pasting a snippet from the Console. It shows a Pricing Table and lets a Customer pay for one of its Pricing Plans in a window served by PayBridge, so the host page never sees the payment details.
_Avoid_: Embed file, Widget, Payment button, Hosted checkout

**Pricing Table**:
An ordered set of one to three Pricing Plans, with its look, that an Embedded Checkout shows side by side. One of its Pricing Plans may be marked as recommended. Changing a Pricing Table in the Console changes every page that embeds it. A Pricing Table holds no money, so it can be deleted; pages that embed it then show that it is unavailable. A Pricing Table belongs to one Mode and holds only Pricing Plans of that Mode. An Embedded Checkout whose Publishable Key is in the other Mode shows the Pricing Table as unavailable.
_Avoid_: Pricing page, Widget, Plan group

**Customer Reference**:
An identifier of the Customer that the Organization passes to an Embedded Checkout (such as its own user id), or the email the Customer types in. It is carried on the Payment and its Webhooks so the Organization knows whom a purchase is for. It comes from the browser, so it is never proof of anything.
_Avoid_: Customer ID, User ID, Buyer

**Upstream Reference**:
The identifier of the order or obligation a Payment settles. The Organization's system assigns it when it creates the Payment with an API Key; PayBridge assigns it when a Customer starts the Payment from an Embedded Checkout. It is unique within an Organization's Mode and never changes after the Payment is created.
_Avoid_: Order ID, Merchant Reference

**Attempt Key**:
The identifier of a PaymentTransaction, sent to the PaymentGateway and matched against the gateway's callbacks and reconciliation.
_Avoid_: Transaction ID, Idempotency Key

**Provider Reference**:
The transaction identifier that a PaymentGateway assigns to a PaymentTransaction. It may not exist until the customer has completed payment with the gateway.
_Avoid_: Gateway ID, External ID

**Refund**:
A return of money already collected by a succeeded PaymentTransaction to the customer. A PaymentTransaction can have many Refunds, and their total cannot exceed the Payment's amount.
_Avoid_: Reversal, Chargeback

**Payment Expiry**:
The deadline set on a Payment when it is created. After it, the Payment accepts no new PaymentTransaction, and any unpaid attempt is closed.
_Avoid_: Timeout, TTL

**Late Success**:
A PaymentGateway reporting that a PaymentTransaction has been paid after Core has already closed it or moved on from it.
_Avoid_: Late callback, Duplicate payment

**Callback**:
A server-to-server notification that a PaymentGateway sends to PayBridge about a PaymentTransaction. Callbacks are inbound only; notifications PayBridge sends to an Organization are not Callbacks.
_Avoid_: Webhook, IPN, Notification

**Ignored Callback**:
A verified PaymentGateway callback that does not concern any PayBridge PaymentTransaction (an event type the plugin does not handle, or a provider object PayBridge did not create). Core acknowledges it with the plugin's acknowledgement and stores nothing.
_Avoid_: Dropped webhook, Skipped event

**Organization**:
A business that collects payments through PayBridge. Every Payment, PaymentTransaction, Refund and Review belongs to exactly one Organization, and nobody in one Organization can see another Organization's data. A Super Admin can suspend an Organization: it then accepts no new Payments in either Mode and its Users cannot sign in, but Callbacks for attempts already under way are still processed.
_Avoid_: Merchant, Tenant, Company, Account

**User**:
A person who can sign in to PayBridge. A User is either a Super Admin or belongs to exactly one Organization; someone working for two Organizations has two Users. A deactivated User cannot sign in and cannot change anything from that moment; they lose even read access within minutes. Their past actions stay recorded under their name.
_Avoid_: Account, Member

**Invitation**:
An email asking a person to become a User with a given Role. The person sets their own password when they accept it. A Super Admin invites an Organization's first Organization Admin; Organization Admins invite the rest.
_Avoid_: Sign-up, Registration

**Password Reset**:
An email letting a User who forgot their password set a new one. It works once and expires; it never reveals whether an email address belongs to a User.
_Avoid_: Password recovery, Forgot password

**Role**:
The fixed position a User holds: Super Admin, Organization Admin, or Operator. A Role grants a fixed set of Permissions.
_Avoid_: Group, Profile

**Permission**:
One named action a User may perform, such as resolving a Review. Access is always decided by Permission, never by Role name.
_Avoid_: Right, Scope, Privilege

**Mode**:
One of the two separate worlds inside an Organization: Live, where real money moves, and Test, where an Organization tries PayBridge without it. Every Payment, PaymentTransaction, Refund, Review, Payment Event, Webhook, Webhook Endpoint, Pricing Plan and Pricing Table belongs to exactly one Mode, and nothing in one Mode can see or affect the other. Users, Roles and Permissions have no Mode; the same User does the same things in both. An Organization Admin can delete all of an Organization's Test data at once; Live data is never deleted that way.
_Avoid_: Environment, Sandbox, Livemode

**API Key**:
The secret an Organization's own system uses to call PayBridge. The Organization and the Mode a request acts in are always the API Key's; nothing in the request can change them. An Organization can hold several API Keys in each Mode at once so it can rotate them.
_Avoid_: Token, Client secret, Merchant key

**Gateway Connection**:
An Organization's own account with one PaymentGateway in one Mode: its credentials and whether it is enabled. In Test Mode the credentials are the PaymentGateway's sandbox ones. An Organization has at most one per PaymentGateway and Mode; a PaymentGateway without a sandbox cannot be connected in Test Mode. Money collected through it goes straight to the Organization, not to PayBridge. Disabling it stops new PaymentTransactions through that PaymentGateway but not the ones already under way.
_Avoid_: Gateway config, Integration, Merchant account

**Super Admin**:
A User who runs the PayBridge platform itself and belongs to no Organization. A Super Admin can do anything in any Organization and in either Mode, including resolving its Reviews; anything a Super Admin changes in an Organization is shown to that Organization as done by the platform.
_Avoid_: Root, System admin, Platform owner

**Organization Admin**:
A User who manages one Organization: its Users, API Keys, Gateway Connections, Pricing Plans, Publishable Keys and Webhook Endpoints, on top of everything an Operator does. An Organization always has at least one active Organization Admin.
_Avoid_: Owner, Org manager, Admin

**Operator**:
A User of an Organization who monitors that Organization's Payments and Webhooks, resends failed Webhooks, and resolves its Reviews. An Operator can see Pricing Plans but not change them. Every status change an Operator makes is recorded with their identity and a note.
_Avoid_: Admin, Administrator, Support agent

**Review**:
A PaymentTransaction that Core could not settle automatically. It carries a review reason (ambiguous provider status, amount mismatch, late success on a closed Payment, or duplicate success) and the time it opened. It closes by automatic re-query or by an Operator's resolution.
_Avoid_: Dispute, Case, Flag

**Payment Event**:
A record that Core emits when a Payment or PaymentTransaction reaches a status other systems must know about.
_Avoid_: Outbox message, Notification

**Webhook**:
The delivery of a Payment Event to one of the Organization's Webhook Endpoints, signed so the Organization can trust it. A Payment Event may be delivered more than once and in any order, and failed deliveries are retried for a few days. Inbound notifications from a PaymentGateway are Callbacks, not Webhooks.
_Avoid_: Callback, Notification

**Webhook Endpoint**:
A URL of the Organization's system that receives Webhooks, with its own signing secret and the kinds of Payment Event it wants. It belongs to one Mode and receives only that Mode's Webhooks. An Organization can have several in each Mode.
_Avoid_: Webhook URL, Subscription, Listener
