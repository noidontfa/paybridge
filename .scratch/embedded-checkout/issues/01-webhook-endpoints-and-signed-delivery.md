# 01: Webhook Endpoints and signed delivery

**What to build:** This is the tracer bullet for Webhooks. An Organization Admin registers a Webhook Endpoint. From then on, every Payment Event of that Organization is POSTed to the endpoint, signed, so the Organization's system learns that a Payment succeeded without polling. This applies to every Payment, whether it was created through the API or the checkout. A new webhooks module, with its own table prefix, consumes the existing `core-outbox` queue; Payment Core does not know it exists. This ticket does not retry: a failed attempt is recorded and left for 02. See the [spec](../spec.md) (Webhook Endpoint and delivery).

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] An Organization Admin creates a Webhook Endpoint with a URL and the Payment Event kinds it wants: `payment.created`, `payment.succeeded`, `payment.cancelled`, `payment.expired` and `payment.requires_review`. The signing secret is returned in full only once, then shown only by its prefix. The secret is stored encrypted.
- [ ] An Organization Admin lists, edits, disables, enables and deletes Webhook Endpoints. An Organization can have several.
- [ ] Operators are refused on every Webhook Endpoint write. Super Admin writes are labelled as the platform. Writes are sensitive writes (ADR 0008).
- [ ] Consuming an outbox job creates one delivery per enabled, subscribed endpoint of the event's own Organization, idempotently per (event, endpoint). Disabled endpoints and other Organizations' endpoints are never used.
- [ ] Each delivery is an HTTP POST of a JSON envelope:
  - the event id (the outbox event id);
  - the event kind;
  - the time the event was created;
  - the Organization id;
  - `data`, the Payment Event's payload as Core wrote it, so fields Core adds later (such as the checkout origin from 07) flow through without changes here.
- [ ] A signature header carries a timestamp and an HMAC-SHA256 of `timestamp + "." + raw body` under the endpoint's secret.
- [ ] Each attempt has a timeout of about 10 seconds and does not follow redirects. A 2xx answer is a success; anything else is a failure. Each attempt records time, HTTP status, duration and a truncated response body.
- [ ] SSRF protection in production:
  - the host is resolved first, and private, loopback, link-local (including cloud metadata), multicast and reserved IPv4 and IPv6 ranges are refused;
  - the connection goes to exactly the address checked;
  - only HTTPS is allowed;
  - the same check runs when the URL is saved;
  - a refused address is recorded as a failed attempt with a clear reason;
  - development and tests allow localhost.
- [ ] The Console has a Webhook Endpoints page in Organization settings, reached through the BFF.
- [ ] The isolation and architecture checks cover the new module: it uses Payment Core and identity only through their public ports, and only its own Prisma layer imports the database client.
- [ ] The seed creates a Webhook Endpoint pointing at a local receiver.
- [ ] Integration tests start a local HTTP receiver and drive Payments through Core. They assert:
  - the signature verifies, and the payload is correct;
  - fan-out to two endpoints;
  - subscription filtering;
  - no cross-Organization delivery;
  - a disabled endpoint is skipped;
  - a private address is refused when SSRF protection is turned on.
