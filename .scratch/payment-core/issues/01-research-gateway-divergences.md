Labels: wayfinder:research
Type: research
Status: resolved
Blocked by: none

# Research: gateway divergences from VNPay, ZaloPay and Stripe

## Question

Which behaviours of VNPay, ZaloPay and Stripe would break a provider-neutral `PaymentGateway` contract and a `PaymentTransaction` state machine if they were assumed away? Investigate each provider against its official API documentation and, where needed, its official SDK source. Cover, per provider:

1. Payment initiation response shape (redirect URL, QR or app payload, client secret) and whether it is synchronous.
2. Provider transaction reference: who generates it, format, maximum length, and uniqueness scope.
3. Amount and currency units for VND (integer units vs zero-decimal handling).
4. Status model: which states exist, which are terminal, and whether a late success can arrive after the attempt has expired.
5. How the final result arrives: browser return URL vs server-to-server IPN/webhook; which one is authoritative; signature scheme; retry and redelivery behaviour.
6. Expiry or timeout of an unpaid attempt.
7. Refund API: partial refunds, multiple refunds per payment, asynchronous completion, idempotency key support.
8. Duplicate callback or webhook behaviour.

Output: one Markdown file at `.scratch/payment-core/research/gateway-divergences.md`, written in English. Each claim cites its primary source URL and the date accessed. End with a short list of "contract implications" for tickets 03, 04 and 05.

## Answer

Full findings, with sources and UNVERIFIED markers, are in [`research/gateway-divergences.md`](research/gateway-divergences.md). The divergences that matter most for the design:

- **Initiation shapes differ**: VNPay builds a signed redirect URL locally with no API call. ZaloPay returns `order_url`, SDK tokens and a VietQR string from a synchronous `/v2/create`. Stripe returns a `client_secret` or a Checkout `url`. The port needs a discriminated `NextAction` union, not a bare `redirectUrl`.
- **References are generated at different times with different scopes**: VNPay `vnp_TxnRef` is merchant-generated and unique per day. ZaloPay `app_trans_id` is merchant-generated with a `yymmdd` prefix. `zp_trans_id` and `vnp_TransactionNo` appear only after payment. Stripe IDs are global and exist from creation. Core needs its own `attemptId` plus a nullable `providerRef`.
- **VND scaling conflicts**: ZaloPay and Stripe take integer VND. VNPay requires the amount multiplied by 100. Core should store integer dong and let the plugin scale.
- **Failure visibility differs**: ZaloPay sends callbacks only on success, so polling is mandatory. Stripe PaymentIntents go back to `requires_payment_method` on decline and never expire on their own. VNPay `07` and `04` are non-binary outcomes that need a hold or reconciliation state.
- **Authoritative result**: VNPay says the IPN, not the Return URL, is authoritative. Stripe says webhooks, not client redirects. ZaloPay says the callback plus `/v2/query`.
- **Refunds are asynchronous**: VNPay and ZaloPay have no refund webhook and need polling. Stripe supports multiple partial refunds, `Idempotency-Key`, and `refund.*` webhooks. VNPay and ZaloPay do not have a refund idempotency header.
- **Signature schemes**: VNPay uses HMAC-SHA512 over query params. ZaloPay uses HMAC-SHA256 with `key1` for requests and `key2` for callbacks. Stripe uses `Stripe-Signature` over the raw body. The port must receive raw bytes, headers and query params.

Several items were marked UNVERIFIED and are recorded as fog on the map.
