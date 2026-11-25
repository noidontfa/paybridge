# 08: Switch the Console to the real API

**What to build:** Make the real API the Console's development default and document how to work either way, so a developer who starts the API, seeds it and starts the Console sees real data end to end.

**Blocked by:** 03, 04, 05, 06, 07

**Status:** ready-for-agent

- [ ] `CONSOLE_API_MOCKS` defaults to `false` in the Console's development environment file, and `CONSOLE_API_BASE_URL` points at the API
- [ ] The README documents the local workflow (start the database, migrate, seed, start the API, start the Console) and how to switch back to mock mode
- [ ] The example env files document every new variable, including `PUBLIC_BASE_URL`
- [ ] Playwright in CI still runs in mock mode and is unchanged; no CI job starts a real API server
- [ ] A local-only command runs the Console's Playwright smoke tests (Overview loads, filtering Payments, resolving a Review) against the real API and a seeded database
- [ ] Every Console screen has been checked against the seeded API with mocks off, and any field that proved impossible to compute from the database is recorded and, if needed, changed in the Console's schema
