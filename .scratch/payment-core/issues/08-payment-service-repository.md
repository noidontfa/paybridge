Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 04, 05, 07

# PaymentService and Repository boundaries

## Question

Define the application layer of Payment Core. Decide:

1. The use cases `PaymentService` exposes. Candidates: create a `Payment`, start a `PaymentTransaction` through a gateway, handle a browser return, handle a webhook result, switch to another gateway after a failure.
2. The collaborators each use case depends on: the Gateway Manager, repositories, the outbox writer, the queue producer.
3. Transaction boundaries: which writes must commit together.
4. How concurrent updates to the same `PaymentTransaction` are serialised (row lock, optimistic version, or another mechanism).
5. The repository interface: one repository per aggregate, or per table, and what it is allowed to return.

## Answer

<!-- filled in on resolution -->
