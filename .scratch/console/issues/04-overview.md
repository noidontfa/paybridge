# 04: Overview

**What to build:** An Operator lands on the Overview and sees, for a selected range of 24 hours, 7 days or 30 days: volume collected in VND, Payment count, success rate and open Reviews (linking to Exceptions); a chart of volume over time; a chart of Payments by status; a per-PaymentGateway breakdown (count, volume, success rate); and the most recent Payments, each linking to its detail page. The range is kept in the URL.

See [spec](../spec.md): Overview (stories 11–22); Implementation Decisions › API contract (Overview).

**Blocked by:** 02: Payment detail through the BFF and mock mode.

**Status:** resolved

- [x] The mock serves the Overview endpoint for `range` of `24h`, `7d` and `30d`, computed from the fixture store relative to its fixed "now".
- [x] Success rate is succeeded Payments over closed Payments in the range; no revenue or fee figures are shown.
- [x] Charts use Recharts through the shadcn Chart wrapper, read correctly in light and dark themes, and have accessible labels.
- [x] The range selector updates the URL and the data; reload keeps the range.
- [x] Skeletons match the final layout; an empty range shows an empty state; an API error shows an error state with retry.
- [x] Screen tests: figures for each range, the empty state and the error state.
- [x] A Playwright test loads the Overview, changes the range and follows a recent Payment to its detail page.

## Answer

The Overview (`/`) shows, for a range of `24h`, `7d` or `30d` kept in the URL (`/?range=24h`; the default `7d` leaves the URL clean): four figures (volume collected, Payment count, success rate, open Reviews linking to Exceptions), a Recharts area chart of volume over time, a bar chart plus a text list of Payments by status, a per-PaymentGateway table and the eight most recent Payments, each linking to its detail page. Skeletons use the loaded grid; an empty range and an API error (with Retry) have their own states. Tests: unit (`src/mocks/overview.test.ts`, `src/lib/overview-range.test.ts`), a screen test with the shared handlers (`overview-screen.test.tsx`) and Playwright (`e2e/overview.spec.ts`).

Decisions to know about:

- **Endpoint**: `GET /internal/overview?range=24h|7d|30d`, schema in `src/lib/api/overview-schema.ts` (a new file, to keep `schemas.ts` free of conflicts). It is computed by `computeOverview` (`src/mocks/overview.ts`) from the store relative to its fixed "now". An unknown `range` answers 400 `INVALID_RANGE`.
- **Definitions**: Payments are counted and bucketed by creation time. Volume is the sum of the Amounts of succeeded Payments, summed as scaled integers (never floats). Success rate is succeeded over closed (succeeded, cancelled, expired) Payments, 0 to 1, `null` when none is closed. A gateway row uses the gateway of the Payment's latest PaymentTransaction; Payments with none are not in the breakdown. Open Reviews is the count of PaymentTransactions in `REQUIRES_REVIEW`, independent of the range. 24h gives 24 hourly buckets, 7d and 30d give daily buckets.
- **Range in the URL**: `src/lib/overview-range.ts` (`parseRange`, `overviewHref`). The server page reads `searchParams`; `OverviewRoute` calls `router.replace`. `OverviewScreen` takes `range` and `onRangeChange` props, so screen tests need no router.
- **Charts**: `src/components/ui/chart.tsx` is the shadcn Chart wrapper (CLI output, with its `cn` import pointed at `@/lib/utils`; no `cn` package). Colours are given per theme (light and dark values) in the chart configs. Each chart sits in `role="img"` with a summary label, and the status chart has an HTML list with the counts. Chart y-values are plotted as numbers (positions only); every figure shown as text comes from the decimal string.
- **Extension points**: `useOverview` and `overviewKeys.all` (`src/lib/queries/overview.ts`; ticket 06 invalidates `overviewKeys.all`), `getOverview` in the API client.
- `pnpm dlx shadcn add chart` rewrites `package.json` with the `cn` package and a pinned recharts: do not run it again; add the component by hand.
