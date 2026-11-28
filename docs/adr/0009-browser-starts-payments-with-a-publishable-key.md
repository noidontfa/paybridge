# Customers' browsers start Payments with a Publishable Key

An embedded checkout on an Organization's web page starts a Payment by calling PayBridge directly from the Customer's browser with a Publishable Key, instead of going through the Organization's own backend with an API Key. We chose this so that an Organization can sell a Pricing Plan by pasting a script into a page, without writing any server code. The cost is a second, public credential that anyone can copy from the page source, so it may only start Payments for that Organization's Pricing Plans, and the Amount always comes from the Pricing Plan on the server, never from the browser.

## Considered Options

- **Browser calls the Organization's backend, which calls PayBridge with an API Key** (rejected): no public credential, but every Organization has to write and host server code, which defeats "just embed a script".
- **Browser calls PayBridge with a Publishable Key** (chosen).

## Consequences

- Anything the browser reports (a success event, a Customer identifier) can be forged, so it is used only for the page's own display. An Organization learns that a Payment succeeded from a Webhook, or by reading the Payment with its API Key.
- Because the key is public, PayBridge must limit what it can be used for and how often.
