# Operator read models live in Payment Core

The read endpoints the Operator Console needs (`/internal/overview`, `/internal/payments`, `/internal/reviews`, `/internal/gateways`, `/internal/callbacks`, `/internal/payment-events`, `/internal/status-transitions`) are implemented inside `apps/api/src/payment-core`, as read-only use-cases backed by read-model repositories. We did not create a separate `ConsoleModule`. We chose this because every table these endpoints read is a `core_*` table, and [ADR 0001](0001-shared-public-schema-with-table-prefix-ownership.md) makes the module that owns a table prefix the only code that touches it. The write route that already exists, `POST /internal/payments/:id/review-resolution`, follows the same rule and stays where it is. The cost is that Payment Core now contains operator-facing projections that are not payment rules.

The rule going forward: **the module that owns a table prefix owns both the reads and the writes of those tables.** A new domain (for example a product catalog with images, names and storefront layout settings) is its own module with its own table prefix and its own `/internal` controllers. It is not added to Payment Core and not added to a shared Console module.

## Considered Options

- **A `ConsoleModule` that reads every domain's tables** (rejected): one place for operator routes, but it reads tables it does not own and becomes the place every future operator feature lands.
- **A `ConsoleModule` that owns all `/internal` controllers, reads and writes, and delegates to domain use-cases** (rejected): it would force `review-resolution` out of Payment Core and turn the module into a facade over every domain.
- **Operator reads in Payment Core, new domains as their own modules** (chosen).

## Consequences

- Read-only code obeys Core's existing boundary checks (`architecture.spec.ts`): outside `infrastructure/prisma/`, Core never imports the database client, so every query, including the Overview aggregates, lives in a read-model repository there. Read use-cases open no transaction, like `GetPayment`.
- The Console's response shapes are the contract. The API conforms to them, and a contract test runs API responses through a copy of the Console's Zod schemas (copied by hand, as ADR 0004 already accepts for types).
- A future product domain brings public routes for a client-side embed script. Those routes are public API, not `/internal`, and the browser embed script never goes through the Console's BFF.
- When the first non-`POST` write endpoint arrives, the BFF's allowed methods (`GET`, `HEAD`, `POST` today in `apps/console/src/server/bff-proxy.ts`) must be extended, together with its `actor` handling. A future reader should not widen the BFF without revisiting ADR 0004.
- If the operator read models in Payment Core grow large, they can move to their own module that still reads only `core_*` tables through repositories; this decision would then need revisiting.
- Layout (refactor, November 2026): each Console view has one folder under `apps/api/src/payment-core/console-read/<view>/` holding its controller and query schema, all wired by one `ConsoleReadModule`. The queries stay in `payment-core/infrastructure/prisma/console-read/`. A view adds a use case only when it has logic of its own (Overview, Payment Gateways). Otherwise the controller calls its read repository, and each list defines its cursor once with `keysetCursor`. Moving the read models out of Payment Core was considered again and rejected: they would still need Payment Core's read repositories, domain rules and Gateway Manager, so the new module would only hold controllers.
