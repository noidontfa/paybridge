# 03: Payment detail for Operators

**What to build:** `GET /internal/payments/:id`: a Payment with every PaymentTransaction (oldest first, with Provider Reference and NextAction), each PaymentTransaction's status history, and the Payment's Payment Events, so the Console's Payment detail page works on real data.

**Blocked by:** 02

**Status:** resolved

- [x] The response matches the Console's operator Payment detail contract
- [x] Each PaymentTransaction carries its Provider Reference (when present), NextAction, review fields and its status transitions with from status, to status, trigger, actor, note and time
- [x] The Payment's Payment Events are listed
- [x] The gateway-switch Payment in the seed shows both attempts in order
- [x] An unknown or non-UUID id returns 404 with the API's standard error response
- [x] Integration tests over HTTP validate the response against the copied Console schema
- [x] The Console's Payment detail page, with mocks turned off, renders a seeded Payment including a Review

## Answer

`GET /internal/payments/:id` works on real PostgreSQL with the shape of the Console's `operatorPaymentSchema`. The last criterion (the Payment detail page with mocks off, in a browser) was not exercised; every response in the tests is parsed with the copied Console schemas instead.

- Code: `PaymentDetailModule` (`console/payment-detail.module.ts`, registered in `console-read.module.ts`), use-case `application/use-cases/console/get-payment-detail.ts`, read repository `infrastructure/prisma/console-read/payment-detail-read.repository.ts`, controller `http/console/payment-detail.controller.ts`.
- Attempts are ordered by `createdAt` then `id`; each attempt's transitions are the `PAYMENT_TRANSACTION` rows for its id (oldest first); events are the Payment's outbox rows (oldest first). Payment-level transitions are not part of the contract and are not returned.
- `providerReportedAmount` is read from `providerMetadata.providerReportedAmount` on the attempt (the seed's storage, ticket 01). Core persists no such value yet.
- An unknown id and a non-UUID id both return 404 through the standard error envelope (`NotFoundException`). No migration or index was needed.
- Test: `apps/api/test/payment-core/console/payment-detail.int-spec.ts` (seeded data; uses `operatorPaymentSchema` already in `test/contract/console/schemas.ts`, so no new contract copy).
