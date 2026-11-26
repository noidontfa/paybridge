# 10: Notes-only Reviews are shown as resolvable after 72 hours

**Status:** needs-triage

**What is wrong:** `GET /internal/reviews` gives every Review a `resolvableAt` of opening time plus 72 hours. The Console shows "Resolvable from …" from it (`apps/console/src/components/review/review-panel.tsx`, `resolvableFrom`). But `decideReviewResolution` (`apps/api/src/payment-core/domain/rules/review-resolution.ts`) only ever accepts a note for `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS`: their status cannot change until refunds exist. For those two reasons the Console promises a resolution that the API will refuse.

**Found by:** the Console read restructure (branch `refactor/console-read-slices`). It was left out of that refactor on purpose because the fix changes the contract.

**What a fix needs:**

- [ ] The API: `resolvableAt` is `null` for the notes-only reasons. Put the rule next to `reviewResolvableAt` in `review-resolution.ts`, so the Console read and the resolution share it.
- [ ] The Console: `reviewListSchema` in `src/lib/api/reviews.ts` makes `resolvableAt` nullable, `review-panel.tsx` shows "Notes only until refunds exist" instead of a time, and the mock in `src/mocks/reviews.ts` follows.
- [ ] The contract copy in `apps/api/test/contract/console/reviews.ts` is updated together with the Console schema, and `reviews.int-spec.ts` covers both notes-only reasons.
