Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 01, 03

# Payment and PaymentTransaction state machines

## Question

Design the state machines for `Payment` and `PaymentTransaction`. Decide:

1. The states of each, which are terminal, and the allowed transitions.
2. Who may trigger each transition: a client request, a gateway response, a webhook, a timeout, or an internal job.
3. How a `Payment` moves to a new `PaymentTransaction` after one fails or expires (for example, a customer switches from VNPay to ZaloPay). What state the earlier attempt ends in.
4. Races between the browser return and the webhook for the same `PaymentTransaction`, and what a late success after expiry does. Resolve these at the state level.
5. Whether a `Payment` can succeed after an attempt has been cancelled or expired.

Use the findings from the research ticket for provider status models.

## Answer

<!-- filled in on resolution -->
