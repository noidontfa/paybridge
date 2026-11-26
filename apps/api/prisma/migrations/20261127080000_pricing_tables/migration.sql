-- Pricing Tables (embedded-checkout ticket 08): one to three Pricing Plans
-- shown on a host page with a simple look, owned by the checkout module
-- (`chk_` prefix, ADR 0001).

CREATE TYPE "chk_pricing_table_theme" AS ENUM ('light', 'dark');

CREATE TYPE "chk_pricing_table_language" AS ENUM ('vi', 'en');

CREATE TABLE "chk_pricing_tables" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "main_color" TEXT NOT NULL,
    "theme" "chk_pricing_table_theme" NOT NULL,
    "language" "chk_pricing_table_language" NOT NULL,
    "button_text" TEXT NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "updated_by_role" TEXT NOT NULL,
    "updated_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chk_pricing_tables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chk_pricing_table_plans" (
    "pricing_table_id" UUID NOT NULL,
    "pricing_plan_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "chk_pricing_table_plans_pkey" PRIMARY KEY ("pricing_table_id","pricing_plan_id")
);

CREATE INDEX "chk_pricing_tables_org_created_at_idx" ON "chk_pricing_tables"("organization_id", "created_at", "id");

CREATE INDEX "chk_pricing_table_plans_org_plan_idx" ON "chk_pricing_table_plans"("organization_id", "pricing_plan_id");

CREATE UNIQUE INDEX "chk_pricing_table_plans_table_position_key" ON "chk_pricing_table_plans"("pricing_table_id", "position");

ALTER TABLE "chk_pricing_tables" ADD CONSTRAINT "chk_pricing_tables_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "chk_pricing_table_plans" ADD CONSTRAINT "chk_pricing_table_plans_pricing_table_id_fkey"
  FOREIGN KEY ("pricing_table_id") REFERENCES "chk_pricing_tables"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "chk_pricing_table_plans" ADD CONSTRAINT "chk_pricing_table_plans_pricing_plan_id_fkey"
  FOREIGN KEY ("pricing_plan_id") REFERENCES "chk_pricing_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "chk_pricing_table_plans" ADD CONSTRAINT "chk_pricing_table_plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot declare these: the main colour is `#rrggbb` in lower case,
-- a table shows at most three Pricing Plans, and at most one is recommended.
ALTER TABLE "chk_pricing_tables" ADD CONSTRAINT "chk_pricing_tables_main_color_hex" CHECK ("main_color" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "chk_pricing_table_plans" ADD CONSTRAINT "chk_pricing_table_plans_position_range" CHECK ("position" BETWEEN 0 AND 2);
CREATE UNIQUE INDEX "chk_pricing_table_plans_one_recommended_key" ON "chk_pricing_table_plans"("pricing_table_id") WHERE "recommended";
