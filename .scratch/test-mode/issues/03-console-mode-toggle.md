# 03: Console Mode toggle

**What to build:** A User switches the whole Console between Test and Live, always sees which one they are in, and every Console page reads and writes that Mode's data. See the [spec](../spec.md) (Console and BFF) and [ADR 0004](../../../docs/adr/0004-console-reaches-api-only-through-its-bff.md).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A Mode toggle in the Console header, following the Organization switcher's pattern: a cookie, forwarded by the BFF as a Mode header, then a reload.
- [ ] The API reads the Mode header for every User principal (not only Super Admins); a missing or invalid header means Live.
- [ ] With no cookie set, the Console defaults to Test when the Organization has no Live Payments, and to Live otherwise. A Super Admin defaults to Live.
- [ ] A "Test data" banner in a distinct colour on every screen in Test Mode.
- [ ] Every existing Console page (Payments, Reviews, Webhooks, API Keys, Publishable Keys, Gateways, Pricing Plans, Pricing Tables, Webhook Endpoints) shows and creates records in the selected Mode only.
- [ ] Permissions are unchanged: an Operator can do in Test exactly what they can do in Live.
- [ ] Tests: BFF forwards the Mode; API honours it for Organization Admins and Operators; defaulting rules; a Test-Mode page never shows Live data.
