Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 01

# Domain model and invariants for Payment and PaymentTransaction

## Question

Define the domain model of `Payment` and `PaymentTransaction` using the terms in `GLOSSARY.md`. Decide:

1. Entities, value objects and identity for each. Which fields belong to `Payment` and which to `PaymentTransaction`.
2. Amount and currency representation (VND and any other currency), using the unit findings from the research ticket.
3. The upstream reference on `Payment` (for example `merchantOrderId`) and its uniqueness rule.
4. The `1 Payment : N PaymentTransaction` relation, including the rule that at most one attempt may be in-flight at a time (to be confirmed).
5. Invariants that must always hold, stated as testable rules.
6. Data hooks for `Refund` (see the Refund data hook in the map's Not yet specified section) and for a future `merchantId`, without implementing either.

Add any new domain terms to `GLOSSARY.md` inline, in English.

## Answer

<!-- filled in on resolution -->
