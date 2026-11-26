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

**Upstream Reference**:
The identifier that the calling system assigns to the order or obligation a Payment settles. It is unique within an Organization and never changes after the Payment is created.
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
A business that collects payments through PayBridge. Every Payment, PaymentTransaction, Refund and Review belongs to exactly one Organization, and nobody in one Organization can see another Organization's data. A Super Admin can suspend an Organization: it then accepts no new Payments and its Users cannot sign in, but Callbacks for attempts already under way are still processed.
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

**API Key**:
The secret an Organization's own system uses to call PayBridge. The Organization a request acts for is always the API Key's Organization. An Organization can hold several API Keys at once so it can rotate them.
_Avoid_: Token, Client secret, Merchant key

**Gateway Connection**:
An Organization's own account with one PaymentGateway: its credentials and whether it is enabled. An Organization has at most one per PaymentGateway. Money collected through it goes straight to the Organization, not to PayBridge. Disabling it stops new PaymentTransactions through that PaymentGateway but not the ones already under way.
_Avoid_: Gateway config, Integration, Merchant account

**Super Admin**:
A User who runs the PayBridge platform itself and belongs to no Organization. A Super Admin can do anything in any Organization, including resolving its Reviews; anything a Super Admin changes in an Organization is shown to that Organization as done by the platform.
_Avoid_: Root, System admin, Platform owner

**Organization Admin**:
A User who manages one Organization: its Users, API Keys and Gateway Connections, on top of everything an Operator does. An Organization always has at least one active Organization Admin.
_Avoid_: Owner, Org manager, Admin

**Operator**:
A User of an Organization who monitors that Organization's Payments and resolves its Reviews. Every status change an Operator makes is recorded with their identity and a note.
_Avoid_: Admin, Administrator, Support agent

**Review**:
A PaymentTransaction that Core could not settle automatically. It carries a review reason (ambiguous provider status, amount mismatch, late success on a closed Payment, or duplicate success) and the time it opened. It closes by automatic re-query or by an Operator's resolution.
_Avoid_: Dispute, Case, Flag

**Payment Event**:
A record that Core emits when a Payment or PaymentTransaction reaches a status other systems must know about.
_Avoid_: Outbox message, Notification

**Webhook**:
The delivery of a Payment Event to the Organization's system. Not built yet; inbound notifications from a PaymentGateway are Callbacks, not Webhooks.
_Avoid_: Callback, Notification
