# 07: Checkout Payments through public endpoints

**What to build:** This is the tracer bullet for buying. With a Publishable Key from an allowed website, a browser starts (or resumes) a Payment for a Pricing Plan, starts an attempt with an allowed PaymentGateway, and reads the status. The Amount and Payment Expiry come from the Pricing Plan on the server. PayBridge assigns the Upstream Reference. The Payment records which Pricing Plan it was for and who the Customer is, and its Payment Events (and therefore its Webhooks) carry that too. See the [spec](../spec.md) (Public checkout endpoints, Payment Core changes).

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] Payment Core's create Payment accepts an optional checkout origin:
  - the Pricing Plan id;
  - the Pricing Plan name at that moment;
  - a Customer Reference, which is an opaque id, an email, or both.

  It is stored on the Payment and included in the payload of the Payment's Payment Events.
- [ ] For checkout Payments, Core generates the Upstream Reference with a recognisable prefix. It remains unique within the Organization.
- [ ] **Start or resume a checkout Payment.**
  - Input: a Pricing Plan, an optional Customer Reference and/or email, and a checkout session token.
  - It returns the open Payment for the same session token, Pricing Plan and Customer Reference if there is one. Otherwise it creates a new Payment with the Pricing Plan's Amount and Payment Expiry.
  - The request never carries an Amount.
- [ ] **Start an attempt** on that Payment with a chosen PaymentGateway and a return URL. It reuses Core's start attempt and returns the NextAction. The gateway must be allowed by the Pricing Plan and enabled for the Organization.
- [ ] **Read the checkout Payment's status.** Only Payments started with the same Organization's Publishable Key are visible.
- [ ] Every checkout endpoint needs a Publishable Key and an allowed origin (06).
- [ ] When the checkout cannot sell (archived Pricing Plan, suspended Organization, disallowed or disabled gateway, unknown Pricing Plan), the response is one generic "unavailable" error with a machine-readable reason code for developers.
- [ ] Starting Payments is rate-limited per Publishable Key and per client IP. The limits are configuration values.
- [ ] Payments already under way finish normally after their Pricing Plan is archived or the Organization is suspended.
- [ ] The Console's Payment detail shows the checkout origin (Pricing Plan, name at purchase, Customer Reference). The Payments list filters by Pricing Plan.
- [ ] Deleting a Pricing Plan with checkout Payments is refused, as 05 already enforces.
- [ ] Integration tests cover:
  - the Amount taken from the Pricing Plan even when the browser sends one;
  - resume within Payment Expiry, and a new Payment after it;
  - gateway allow-lists;
  - every "unavailable" reason;
  - rate limits;
  - the generated Upstream Reference;
  - the checkout origin in Payment Events, read models and filters;
  - isolation between Organizations.
