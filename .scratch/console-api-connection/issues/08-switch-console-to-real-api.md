# 08: Switch the Console to the real API

**What to build:** Make the real API the Console's development default and document how to work either way, so a developer who starts the API, seeds it and starts the Console sees real data end to end.

**Blocked by:** 03, 04, 05, 06, 07

**Status:** resolved

- [x] `CONSOLE_API_MOCKS` defaults to `false` in the Console's development environment file, and `CONSOLE_API_BASE_URL` points at the API
- [x] The README documents the local workflow (start the database, migrate, seed, start the API, start the Console) and how to switch back to mock mode
- [x] The example env files document every new variable, including `PUBLIC_BASE_URL`
- [x] Playwright in CI still runs in mock mode and is unchanged; no CI job starts a real API server
- [x] A local-only command runs the Console's Playwright smoke tests (Overview loads, filtering Payments, resolving a Review) against the real API and a seeded database
- [x] Every Console screen has been checked against the seeded API with mocks off, and any field that proved impossible to compute from the database is recorded and, if needed, changed in the Console's schema

## Answer

The Console now defaults to the real API in development, and every screen was checked against the seeded API with mocks off (API on :3000, `pnpm db:deploy`, `pnpm db:seed`, Console with `CONSOLE_API_MOCKS=false`).

- Env: `apps/console/.env.development` has `CONSOLE_API_MOCKS=false` and `CONSOLE_API_BASE_URL=http://localhost:3000`. The old value (3001) was a placeholder; the API listens on 3000, so the Console dev server now runs on 3001 (`next dev -p 3001`). `.env.example` updated; `PUBLIC_BASE_URL` was already in the API's example files (ticket 06) and is now in the README env table.
- README: new section "Console against the real API" (start database, migrate, seed, API, Console; how to switch to mock mode via `.env.local`; Playwright modes).
- CI untouched: `playwright.config.ts` still sets mock env explicitly; `pnpm test:e2e` (29 tests) passes in mock mode.
- Local-only command: `pnpm --filter @paybridge/console test:e2e:real` (`playwright.real.config.ts`, specs in `apps/console/e2e-real/smoke.spec.ts`). Four tests: Overview loads and follows a recent Payment; filtering Payments; every screen (Overview, Payments + detail, Exceptions, Gateways stripe/fake, Callbacks + detail, Events + detail, Audit log) renders without an API-shape error; resolving a Review. All pass. The resolving test changes the data: run `pnpm db:seed` before the next run.
- Mismatch found and fixed: `POST /internal/payments/:id/review-resolution` answers with the Payment (with attempts), while the Console schema (written for the mock) expected `{ paymentId, attemptId, attemptStatus, paymentStatus }`. The resolution succeeded but the UI showed "did not match the expected shape". Fix in the Console client only (`src/lib/api/review-resolution.ts`: `reviewResolutionResponseSchema` accepts both shapes, `toReviewResolutionResult` reduces them; unit test `review-resolution.test.ts`). The API response is unchanged.
- No field proved impossible to compute from the database; no other Console schema changed. Known gaps unchanged: `recentErrors` is `[]`, `providerReportedAmount` comes from `providerMetadata`, seeded Stripe Callbacks fail processing because no Stripe plugin is registered without keys (expected, shows as FAILED data).
- Not checked: visual correctness by eye (checks were by assertions and absence of errors), `--bulk` data in the browser, production build.
