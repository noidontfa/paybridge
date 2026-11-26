-- Checkout Payments (embedded-checkout ticket 07), Payment Core side: a
-- Payment the Embedded Checkout created records its checkout origin, the
-- Pricing Plan (id and name at that moment) and the Customer Reference. Plain
-- columns, no foreign key into `chk_`, so Payment Core stays independent.

ALTER TABLE "core_payments" ADD COLUMN     "customer_email" TEXT,
ADD COLUMN     "customer_ref" TEXT,
ADD COLUMN     "pricing_plan_id" UUID,
ADD COLUMN     "pricing_plan_name" TEXT;

-- The Payments list filtered by Pricing Plan.
CREATE INDEX "core_payments_org_pricing_plan_idx" ON "core_payments"("organization_id", "pricing_plan_id", "created_at", "id");

-- A checkout origin is whole: a Pricing Plan id comes with its name, and a
-- Customer Reference only with a Pricing Plan.
ALTER TABLE "core_payments" ADD CONSTRAINT "core_payments_checkout_origin_whole" CHECK (
  ("pricing_plan_id" IS NULL) = ("pricing_plan_name" IS NULL)
  AND ("pricing_plan_id" IS NOT NULL OR ("customer_ref" IS NULL AND "customer_email" IS NULL))
);
