-- Checkout sessions (embedded-checkout ticket 07), checkout module side: which
-- browser session, Pricing Plan and Customer Reference each checkout Payment
-- was started for, so a reopened checkout resumes the same open Payment.
-- `payment_id` points into Payment Core without a foreign key.

CREATE TABLE "chk_checkout_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "pricing_plan_id" UUID NOT NULL,
    "customer_reference" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "publishable_key_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chk_checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chk_checkout_sessions_payment_id_uq" ON "chk_checkout_sessions"("payment_id");

CREATE INDEX "chk_checkout_sessions_lookup_idx" ON "chk_checkout_sessions"("organization_id", "session_token_hash", "pricing_plan_id", "customer_reference", "customer_email", "created_at");

ALTER TABLE "chk_checkout_sessions" ADD CONSTRAINT "chk_checkout_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "chk_checkout_sessions" ADD CONSTRAINT "chk_checkout_sessions_pricing_plan_id_fkey"
  FOREIGN KEY ("pricing_plan_id") REFERENCES "chk_pricing_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
