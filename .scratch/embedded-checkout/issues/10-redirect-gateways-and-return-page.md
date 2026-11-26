# 10: Redirect gateways and the return page

**What to build:** A Customer paying with a gateway that leaves the site (for example VNPay) comes back to a PayBridge return page. That page shows the result and then forwards the Customer to the Organization's success or cancel page, or back to the page they started from. See the [spec](../spec.md) (SDK and checkout page).

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] When the NextAction is a redirect, the checkout leaves the modal for the gateway's page. Start attempt already accepts a caller-supplied return URL, and the checkout passes the checkout app's return page.
- [ ] The return page reads the checkout Payment's status (07) and shows success, cancellation, expiry or "still processing" in the Pricing Table's language. While processing, it polls.
- [ ] It then forwards the Customer to the target URL:
  - the snippet's success or cancel URL;
  - otherwise the Pricing Plan's;
  - otherwise the host page the Customer started from, which the SDK passes through the checkout.
- [ ] The return page never treats the redirect's query parameters as proof of payment. Only the status from the API counts.
- [ ] Playwright covers:
  - a redirect purchase with the fake gateway, landing on the snippet's success URL;
  - the Pricing Plan's URL used when the snippet sets none;
  - falling back to the host page;
  - the cancel path.
