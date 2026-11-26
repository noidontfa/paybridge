-- Webhook deliveries in the Console (embedded-checkout ticket 03). A resend or
-- a test send records who asked for it on the attempt (the webhooks audit
-- log); automatic attempts leave it null. A Payment's deliveries are listed
-- on its detail page, so deliveries are indexed by Payment.

-- AlterTable
ALTER TABLE "wh_delivery_attempts" ADD COLUMN "triggered_by_user_id" UUID;
ALTER TABLE "wh_delivery_attempts" ADD COLUMN "triggered_by_role" TEXT;
ALTER TABLE "wh_delivery_attempts" ADD COLUMN "triggered_by_name" TEXT;

-- CreateIndex
CREATE INDEX "wh_deliveries_organization_payment_idx" ON "wh_deliveries"("organization_id", "payment_id");
