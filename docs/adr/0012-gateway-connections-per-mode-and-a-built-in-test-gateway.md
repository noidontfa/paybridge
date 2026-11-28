# Gateway Connections are per Mode, and PayBridge provides its own Test Gateway

PaymentGateways offer test environments in different shapes: Stripe uses the same host and tells test from live by the key, VNPay and ZaloPay use a separate sandbox host with separate merchant credentials, and some gateways have no sandbox at all. So a Gateway Connection belongs to one Mode (at most one per PaymentGateway and Mode), Core passes the Mode to the Gateway Plugin, and the plugin alone chooses the gateway's sandbox or production environment and declares which Modes it supports; Core never knows a gateway's hosts. On top of the gateways' own sandboxes, PayBridge provides a Test Gateway that exists only in Test Mode, because real sandboxes need each Organization to onboard with each gateway, are unreliable, and almost never let anyone force the awkward outcomes (decline, pending, wrong Amount, Late Success) that Core must handle. The cost is a Gateway Plugin and a simulator page PayBridge must maintain as a product feature, not test code.

## Considered Options

- **Gateways' own sandboxes only** (rejected): tests the real integration, but an Organization cannot try PayBridge before onboarding with a gateway, and hard cases cannot be reproduced on demand.
- **PayBridge's Test Gateway only** (rejected): always available and fully controllable, but never exercises a real gateway's signatures, redirects or Callback shapes before going live.
- **Both** (chosen).

## Consequences

- The Callback URL already names the Gateway Connection, so it now fixes the Mode as well as the Organization with no new URL scheme; an Organization registers a different URL in each of its gateway's test and live dashboards.
- A plugin refuses credentials that are clearly from the other Mode (for example a Stripe `sk_test_` key on a Live Gateway Connection, and the reverse).
- The Test Gateway is a Gateway Plugin like any other, grown from the existing fake plugin. Its NextAction sends the Customer to a PayBridge simulator page; the chosen outcome, from that page or from an API call made with a Test API Key, reaches Core as a signed Callback through the normal Callback path, so Reviews, Late Success and Webhooks behave exactly as in Live.
- Every Organization has a Gateway Connection to the Test Gateway from creation, needing no credentials. It can be disabled but never exists in Live; copying a Pricing Plan into Live drops it from the plan's allowed PaymentGateways.
- Anyone holding a simulator page link can settle that Test attempt. That is accepted because no money moves in Test Mode.
