<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Structure

All app code lives in `src/`, and `@/*` maps to `./src/*`. The app root holds only config and the `e2e/` suites. Paths below are relative to `src/`.

- `app/`: routing only (pages, layouts, route handlers). No route groups. Pages import screens from `features/`.
- `features/<name>/`: one folder per product feature. Create only what has content:
  - `api.ts`: zod schemas, `z.infer` types and the endpoint functions (a feature with several API files uses `api/<name>.ts`)
  - `hooks/`: query keys and TanStack Query hooks (e.g. `hooks/queries.ts`)
  - `components/`: screens, columns, panels; tests sit next to their subject
  - `utils/`: pure rules and helpers
  - There is no `types.ts`; types come from the zod schemas.
- `components/`: shared UI. `ui/` is shadcn (unchanged), `layout/` is the app shell (once per screen), `shared/` holds reusable blocks used inside pages (`shared/data-table/` holds the table and its URL state).
- `services/`: the browser-to-BFF client (`request`, `ApiError`, pagination). `server/` is the opposite side: server-only BFF code (ADR 0004). Do not mix them.
- `lib/environment.ts` is the only thing in `lib/`. `utils/` has `cn`, `format`, `decimal`. `hooks/` has shared hooks. `mocks/` is MSW (mock mode). `test/` has test helpers.
- `proxy.ts` and `instrumentation.ts` live at the top of `src/`.

Direction rule: `components/ui`, `components/shared`, `services/`, `utils/` and `lib/` never import from `features/`. `components/layout` and `app/` may. Features may import each other directly. Tests are exempt: a test in a shared folder may import feature vocabularies to check that shared code covers them (e.g. `components/shared/status-badges.test.ts`).

No barrel files: import from the file that defines the thing (`@/features/payments/api`), never from an `index.ts`.
