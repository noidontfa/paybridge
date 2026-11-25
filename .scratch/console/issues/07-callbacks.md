# 07: Callbacks list and detail

**What to build:** A developer opens Callbacks and sees what each PaymentGateway sent: PaymentGateway, provider event id, Attempt Key, status, delivery attempts, received time and processed time. They filter by PaymentGateway and status, and open a Callback to see its allow-listed headers, query, raw body (formatted when it is JSON) and last error, with a link to the Payment when the Attempt Key is known.

See [spec](../spec.md): Callbacks (stories 70–74); Implementation Decisions › API contract (Callbacks list and detail).

**Blocked by:** 03: Payments list.

**Status:** ready-for-agent

- [ ] The fixture store includes Callbacks in every inbox status (`RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`), some with an unknown Attempt Key.
- [ ] The mock serves the Callbacks list (`gatewayId`, `status`, cursor pagination) and detail.
- [ ] The list reuses the shared data table, URL state and status badges (Callback status added to the badge mapping).
- [ ] The detail shows the raw body as text, pretty-printed when it parses as JSON, with copy; it never executes or renders it as HTML.
- [ ] The Payment link appears only when the Attempt Key matches a PaymentTransaction.
- [ ] Loading, empty, not-found and error states.
- [ ] Screen tests: filters, JSON and non-JSON bodies, a failed Callback with last error, unknown Attempt Key.
