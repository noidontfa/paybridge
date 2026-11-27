# PayBridge

Payment platform backend. Turborepo + pnpm monorepo, NestJS 12, Prisma 7, PostgreSQL, Redis.

## Structure

```
apps/
  api/                      NestJS application (@paybridge/api)
    prisma/schema.prisma    Prisma schema: Payment Core `core_*` tables (migrations in prisma/migrations)
    prisma.config.ts        Prisma CLI config (loads the same .env files as Nest)
    src/
      config/               env loading + zod validation (fails fast on bad env)
      logger/               pino logging (pretty in dev, JSON in prod)
      common/filters/       global exception filter + error response shape
      database/             PrismaModule / PrismaService (driver adapter: pg)
      health/               GET /api/health, GET /api/health/ready
      swagger.ts            OpenAPI setup
  console/                  Next.js Operator Console (@paybridge/console)
    src/                    all app code (@/* points here)
      app/                  routing only: pages, layouts, route handlers (incl. the BFF)
      features/<name>/      one folder per feature: api.ts, hooks/, components/, utils/
      components/           shared UI: ui/ (shadcn), layout/ (app shell), data-table/, flat shared blocks
      services/             browser-to-BFF client: request, errors, pagination
      server/               server-only BFF code (ADR 0004)
      lib/                  environment only
      utils/                pure helpers: cn, format, decimal
      hooks/                shared React hooks
      mocks/                MSW mock API and seed data
packages/
  typescript-config/        shared tsconfig presets
docker-compose.yml          PostgreSQL 18 + Redis 7 for local development
```

## Requirements

- Node.js **26** (`nvm use`, see `.nvmrc`)
- pnpm 11 (`corepack enable` picks the version from `packageManager`)
- Docker (for PostgreSQL and Redis)

## Getting started

```bash
nvm use
pnpm install
pnpm docker:up          # PostgreSQL :5432 + Redis :6379
pnpm dev                # generates the Prisma client, then starts the API with watch
```

- API: <http://localhost:9999/api/health>
- Swagger UI: <http://localhost:9999/docs> (OpenAPI JSON at `/docs/json`)

## Scripts (run from the repo root)

| Command                            | What it does                                    |
| ---------------------------------- | ----------------------------------------------- |
| `pnpm dev`                         | API in watch mode                               |
| `pnpm build`                       | Generate Prisma client + compile to `dist/`     |
| `pnpm lint` / `pnpm typecheck`     | oxlint (type-aware) / `tsc --noEmit`            |
| `pnpm test` / `pnpm test:e2e`      | Vitest unit / e2e (e2e mocks the database)      |
| `pnpm test:int`                    | Vitest integration tests on real PostgreSQL     |
| `pnpm db:migrate`                  | `prisma migrate dev` (create + apply migration) |
| `pnpm db:deploy`                   | `prisma migrate deploy` (CI / production)       |
| `pnpm db:seed`                     | Seed demo data for the Console (`--bulk N`, `--force`; `SEED-` rows only) |
| `pnpm db:studio`                   | Prisma Studio                                   |
| `pnpm docker:up` / `down` / `logs` | Manage PostgreSQL and Redis                     |

### Integration tests

`pnpm test:int` runs `apps/api/test/**/*.int-spec.ts` against the docker compose PostgreSQL
(`pnpm docker:up` first). Before the run, the global setup drops and recreates the test
database and applies every migration with `prisma migrate deploy`, so each run also proves the
migrations apply to an empty database. Server and credentials come from `DATABASE_URL` in
`apps/api/.env.test`; the database name is `TEST_DATABASE_NAME` (default `paybridge_test`; it
must contain `test`). Use a different name per parallel run:

```bash
TEST_DATABASE_NAME=paybridge_test_mine pnpm test:int
```

Helpers in `apps/api/test/setup/`: `createTestPrismaClient()` (client on the test database) and
`resetDatabase(prisma)` (truncates every `core_*` table; call it in `beforeEach`). Test files run
one at a time because they share the database. Queue tests use the compose Redis with
`QUEUE_PREFIX` set to the test database name, so parallel runs do not share BullMQ keys.

Run production locally: `pnpm build && pnpm --filter @paybridge/api start:prod`.

## Environments

Variables are validated with zod in `apps/api/src/config/env.schema.ts`; the app refuses
to start when they are invalid. Real environment variables always override files. Files
are loaded for `NODE_ENV` (default `development`), first match wins:

`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>` → `.env`

| File                               | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `apps/api/.env.development`        | Committed local defaults, match `docker-compose.yml` |
| `apps/api/.env.test`               | Used by Vitest                                       |
| `apps/api/.env.production.example` | Template. In production inject real env vars/secrets |
| `apps/api/.env.example`            | Reference of every variable                          |

| Variable          | Default                                       | Notes                                     |
| ----------------- | --------------------------------------------- | ----------------------------------------- |
| `NODE_ENV`        | `development`                                 | `development` / `production` / `test`     |
| `PORT`            | `3000`                                        |                                           |
| `DATABASE_URL`    | _required_                                    | PostgreSQL connection string              |
| `REDIS_URL`       | _required_                                    | Redis for BullMQ (`redis://`/`rediss://`) |
| `QUEUE_PREFIX`    | `paybridge`                                   | Prefix of every BullMQ key, no `:`        |
| `LOG_LEVEL`       | `debug` (dev), `info` (prod), `silent` (test) |                                           |
| `SWAGGER_ENABLED` | `true` outside production, `false` in prod    |                                           |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>`                     | Public origin; builds each gateway's Callback URL (`<PUBLIC_BASE_URL>/api/webhooks/<gatewayId>`) |

## Console against the real API

The Operator Console (`apps/console`, Next.js) reads the API through its BFF. In development it uses the
real API by default (`apps/console/.env.development`: `CONSOLE_API_MOCKS=false`,
`CONSOLE_API_BASE_URL=http://localhost:9999`). The API listens on 9999 and the Console dev server on 8888.

```bash
pnpm docker:up                              # PostgreSQL + Redis
pnpm db:deploy                              # apply migrations
pnpm db:seed                                # 22 Payments, Callbacks, Events (`--bulk N` for more; re-run to reset)
pnpm --filter @paybridge/api dev            # API on :9999
pnpm --filter @paybridge/console dev        # Console on :8888
```

- **Mock mode** (no backend, in-process MSW data): put `CONSOLE_API_MOCKS=true` in `apps/console/.env.local`
  (git-ignored) and restart the Console. Mock mode is refused in a production build.
- **Playwright**: `pnpm --filter @paybridge/console test:e2e` always runs in mock mode (this is what CI runs; no CI job
  starts an API). `pnpm --filter @paybridge/console test:e2e:real` is local only: it needs the API running and a seeded
  database, starts its own Console on :3200 with mocks off, and its last test resolves a seeded Review (run
  `pnpm db:seed` again before the next run).
- Every variable is documented in `apps/console/.env.example` and `apps/api/.env.example`.

## Integrations

- [Taking Stripe card payments](docs/integrations/stripe.md): merchant guide (Payment Element, webhook setup, smoke test).

## Conventions

- **Logging**: `nestjs-pino`. Each request gets an `x-request-id` (reused if the client sends
  one), attached to every log line and returned in the response. `authorization`, `cookie` and
  `x-api-key` headers are redacted. Health probes are not logged.
- **Errors**: every error, including unexpected ones, is returned as
  `{ statusCode, error, message, path, method, timestamp, requestId }`. 5xx details are never
  leaked to clients; Prisma `P2002/P2003/P2025/P2000` map to 409/409/404/400.
- **ESM**: Nest 12 is ESM-only, so relative imports end with `.js`.
- **Prisma client** is generated into `apps/api/src/generated/prisma` (git-ignored). Turbo runs
  `db:generate` before `build`, `dev`, `lint`, `test` and `typecheck`; run `pnpm db:generate`
  manually if you call a package script directly.
