# 03: Stripe configuration

Status: ready-for-agent

**What to build:** The app reads three optional Stripe keys and refuses to boot when they are only partly set or mix test and live mode. See [spec](../spec.md), "Configuration".

**Blocked by:** None (can start immediately)

- [ ] `envSchema` (`apps/api/src/config/env.schema.ts`) has optional `STRIPE_SECRET_KEY` (`sk_` or `rk_`), `STRIPE_WEBHOOK_SECRET` (`whsec_`) and `STRIPE_PUBLISHABLE_KEY` (`pk_`).
- [ ] A resolver returns the Stripe config when all three are set and nothing when none are.
- [ ] Boot fails with an error naming the missing keys when one or two are set.
- [ ] Boot fails when the secret and publishable keys are from different modes (`sk_test_` with `pk_live_`, or the reverse).
- [ ] `apps/api/.env.example` and `apps/api/.env.production.example` list the three keys with empty values. No real keys are committed.
- [ ] Tests in `env.schema.spec.ts` cover all-set, none-set, partial, and mixed-mode cases.
