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
The identifier that the calling system assigns to the order or obligation a Payment settles. It is unique across PayBridge and never changes after the Payment is created.
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

**Ignored Callback**:
A verified PaymentGateway callback that does not concern any PayBridge PaymentTransaction (an event type the plugin does not handle, or a provider object PayBridge did not create). Core acknowledges it with the plugin's acknowledgement and stores nothing.
_Avoid_: Dropped webhook, Skipped event
