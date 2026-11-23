Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 01, 03

# PaymentGateway port (Core-owned contract)

## Question

Define the `PaymentGateway` port that Payment Core owns and every plugin implements. Decide:

1. The operations (for example: create a transaction, query status, parse and verify a callback or webhook, refund).
2. Input and output shapes in provider-neutral terms: which fields are required, and where provider-specific data goes as an explicit extension field.
3. The error taxonomy the port exposes, so Core can react without knowing the provider.
4. How a plugin is registered, and how the Gateway Manager resolves it by gateway identifier.
5. The rule that plugins depend on the port only and Core never imports a plugin. How this is enforced (module boundary, lint rule, or both).

Check the port against the research findings. If a provider cannot fit the port without leaking its own concepts into Core, record it as a question for this ticket.

## Answer

<!-- filled in on resolution -->
