-- Pricing Plans (embedded-checkout ticket 05): what an Organization sells,
-- owned by the checkout module (`chk_` prefix, ADR 0001).

CREATE TYPE "chk_pricing_plan_status" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "chk_pricing_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "allowed_gateway_ids" TEXT[],
    "success_url" TEXT,
    "cancel_url" TEXT,
    "expiry_minutes" INTEGER NOT NULL,
    "status" "chk_pricing_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "updated_by_user_id" UUID NOT NULL,
    "updated_by_role" TEXT NOT NULL,
    "updated_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chk_pricing_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chk_pricing_plans_org_created_at_idx" ON "chk_pricing_plans"("organization_id", "created_at", "id");

ALTER TABLE "chk_pricing_plans" ADD CONSTRAINT "chk_pricing_plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot declare CHECK constraints: the Amount is positive and the
-- Payment Expiry stays within Payment Core's range (30 minutes to 24 hours).
ALTER TABLE "chk_pricing_plans" ADD CONSTRAINT "chk_pricing_plans_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "chk_pricing_plans" ADD CONSTRAINT "chk_pricing_plans_expiry_range" CHECK ("expiry_minutes" BETWEEN 30 AND 1440);
