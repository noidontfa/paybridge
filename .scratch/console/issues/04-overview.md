# 04: Overview

**What to build:** An Operator lands on the Overview and sees, for a selected range of 24 hours, 7 days or 30 days: volume collected in VND, Payment count, success rate and open Reviews (linking to Exceptions); a chart of volume over time; a chart of Payments by status; a per-PaymentGateway breakdown (count, volume, success rate); and the most recent Payments, each linking to its detail page. The range is kept in the URL.

See [spec](../spec.md): Overview (stories 11–22); Implementation Decisions › API contract (Overview).

**Blocked by:** 02: Payment detail through the BFF and mock mode.

**Status:** ready-for-agent

- [ ] The mock serves the Overview endpoint for `range` of `24h`, `7d` and `30d`, computed from the fixture store relative to its fixed "now".
- [ ] Success rate is succeeded Payments over closed Payments in the range; no revenue or fee figures are shown.
- [ ] Charts use Recharts through the shadcn Chart wrapper, read correctly in light and dark themes, and have accessible labels.
- [ ] The range selector updates the URL and the data; reload keeps the range.
- [ ] Skeletons match the final layout; an empty range shows an empty state; an API error shows an error state with retry.
- [ ] Screen tests: figures for each range, the empty state and the error state.
- [ ] A Playwright test loads the Overview, changes the range and follows a recent Payment to its detail page.
