# Organizations bring their own PaymentGateway accounts

Each Organization connects its own account with each PaymentGateway (a Gateway Connection holding that Organization's credentials), and the money it collects goes straight to that account. PayBridge orchestrates Payments but never holds funds. We chose this over one platform-wide gateway account per PaymentGateway because holding and paying out other businesses' money makes PayBridge a payment facilitator, with the licensing, settlement and payout work that implies. The cost is that every Organization must onboard with each PaymentGateway itself, and PayBridge must store and protect many sets of credentials.

## Considered Options

- **One platform gateway account, PayBridge pays Organizations out** (rejected): one onboarding per gateway, but PayBridge holds funds and needs settlement, payouts and the licences that come with them.
- **Platform account by default, own account optional** (rejected): it carries both costs at once.
- **Each Organization's own account** (chosen).

## Consequences

- An Organization has at most one Gateway Connection per PaymentGateway, and it can enable or disable it. Disabling stops new PaymentTransactions only: Callbacks, re-queries, reconciliation and Refunds for existing ones keep working, so a Gateway Connection that has been used is never deleted.
- A Callback must identify its Organization before its signature can be verified, because the verifying secret belongs to that Organization's Gateway Connection. The callback URL therefore carries the Organization. (It names the Gateway Connection, which since [ADR 0012](0012-gateway-connections-per-mode-and-a-built-in-test-gateway.md) also fixes the Mode.)
- Gateway credentials are encrypted at rest and are never returned to the Console after they are saved.
