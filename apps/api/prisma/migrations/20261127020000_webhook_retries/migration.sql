-- Webhook retries (embedded-checkout ticket 02): a failed attempt schedules
-- the next one (`next_attempt_at`), and a worker holds a delivery while it
-- makes an attempt (`locked_at`), so two instances never send it at once.
-- The sweep finds due deliveries through `wh_deliveries_due_idx`.

-- AlterTable
ALTER TABLE "wh_deliveries" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3);
ALTER TABLE "wh_deliveries" ADD COLUMN "locked_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "wh_deliveries_due_idx" ON "wh_deliveries"("status", "next_attempt_at");
