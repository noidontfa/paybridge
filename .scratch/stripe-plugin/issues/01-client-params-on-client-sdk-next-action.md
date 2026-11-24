# 01: `clientParams` on the client SDK next action

Status: resolved

**What to build:** The `CLIENT_SDK` next action can carry an optional, provider-neutral bag of string parameters that Core stores and returns without interpreting. Stripe uses it for the publishable key and the return URL. See [spec](../spec.md), "Core change 1".

**Blocked by:** None (can start immediately)

- [ ] `ClientSdkNextAction` in `apps/api/src/payment-core/port/next-action.ts` has `clientParams?: Readonly<Record<string, string>>`.
- [ ] Existing plugins (the fake) compile unchanged.
- [ ] `port.spec.ts` covers a `CLIENT_SDK` next action with and without `clientParams`.
- [ ] The contract suite's next-action check accepts `clientParams` when present and fails a plugin whose `clientParams` values are not strings.
- [ ] An attempt's next action with `clientParams` round-trips through the database and appears unchanged in `GET /payments/:id` and the start-attempt response.
- [ ] The response DTO descriptions (`attempt-response.dto.ts`, `payment-detail-response.dto.ts`) mention `clientParams`.
