# 03: Webhook deliveries in the Console, resend and test send

**What to build:** Operators can see whether a Payment's events reached the Organization's system and can resend one once a broken receiver is fixed. Organization Admins can send a test event to check a receiver before real money arrives. See the [spec](../spec.md) (Webhook deliveries in the Console).

**Blocked by:** 01

**Status:** done

- [ ] The Console lists the Organization's deliveries, newest first, with:
  - the Webhook Endpoint, the event kind and the Payment;
  - the status (pending, succeeded or failed) and the number of attempts;
  - the last attempt's time and HTTP status.

  The list filters by endpoint, status and kind, and pages like the existing Console lists.
- [ ] A delivery's detail shows every attempt: time, HTTP status, duration, truncated response body and refusal reason.
- [ ] A Payment's detail page shows that Payment's deliveries.
- [ ] Operators and Organization Admins can resend a delivery. A resend creates a new attempt on the same delivery with the same event id. It is recorded in the audit log with the User's identity, and Super Admins are labelled as the platform.
- [ ] An Organization Admin can send a `webhook.test` event to one Webhook Endpoint and see its result. Operators cannot.
- [ ] A Webhook Endpoint whose recent deliveries keep failing is marked as failing on the Webhook Endpoints page.
- [ ] Every read and write is scoped to the principal's Organization. Another Organization's delivery behaves as not found.
- [ ] Integration tests cover the read models (with contract schemas, like the other Console reads), resend, test send, Permissions per Role and isolation. A Console e2e spec covers the deliveries page and resend.
