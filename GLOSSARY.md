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
