-- Organizations (ADR 0006): every Payment and everything under it belongs to
-- exactly one Organization. The new `iam_organizations` table is owned by the
-- identity module (ADR 0001). Existing rows move into one default
-- Organization, then `organization_id` becomes NOT NULL.

-- CreateEnum
CREATE TYPE "iam_organization_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "iam_organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "iam_organization_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "iam_organizations_pkey" PRIMARY KEY ("id")
);

-- The default Organization. Its id is fixed: the temporary stub principal
-- (until sign-in exists) and the seed refer to it.
INSERT INTO "iam_organizations" ("id", "name", "status", "updated_at")
VALUES ('00000000-0000-7000-8000-000000000001', 'Default Organization', 'ACTIVE', CURRENT_TIMESTAMP);

-- AlterTable: add the column nullable, backfill, then make it NOT NULL.
ALTER TABLE "core_payments" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_payment_transactions" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_refunds" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_gateway_raw_responses" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_idempotency_keys" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_outbox_events" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_webhook_inbox" ADD COLUMN "organization_id" UUID;
ALTER TABLE "core_status_transitions" ADD COLUMN "organization_id" UUID;

UPDATE "core_payments" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_payment_transactions" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_refunds" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_gateway_raw_responses" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_idempotency_keys" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_outbox_events" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_webhook_inbox" SET "organization_id" = '00000000-0000-7000-8000-000000000001';
UPDATE "core_status_transitions" SET "organization_id" = '00000000-0000-7000-8000-000000000001';

ALTER TABLE "core_payments" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_payment_transactions" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_refunds" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_gateway_raw_responses" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_idempotency_keys" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_outbox_events" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_webhook_inbox" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "core_status_transitions" ALTER COLUMN "organization_id" SET NOT NULL;

-- Idempotency keys are per Organization.
ALTER TABLE "core_idempotency_keys" DROP CONSTRAINT "core_idempotency_keys_pkey";
ALTER TABLE "core_idempotency_keys" ADD CONSTRAINT "core_idempotency_keys_pkey" PRIMARY KEY ("organization_id", "key");

-- Upstream Reference and callback dedupe are unique per Organization.
DROP INDEX "core_payments_merchant_order_id_uq";
CREATE UNIQUE INDEX "core_payments_org_merchant_order_id_uq" ON "core_payments"("organization_id", "merchant_order_id");
DROP INDEX "core_webhook_inbox_gateway_dedupe_uq";
CREATE UNIQUE INDEX "core_webhook_inbox_org_gateway_dedupe_uq" ON "core_webhook_inbox"("organization_id", "gateway_id", "dedupe_key");

-- Operator list indexes lead with the Organization.
DROP INDEX "core_payments_created_at_id_idx";
DROP INDEX "core_payments_amount_id_idx";
CREATE INDEX "core_payments_org_created_at_id_idx" ON "core_payments"("organization_id", "created_at", "id");
CREATE INDEX "core_payments_org_amount_id_idx" ON "core_payments"("organization_id", "amount", "id");
DROP INDEX "core_payment_transactions_review_opened_idx";
CREATE INDEX "core_payment_transactions_org_review_opened_idx" ON "core_payment_transactions"("organization_id", "review_opened_at", "id");
DROP INDEX "core_outbox_events_created_at_id_idx";
CREATE INDEX "core_outbox_events_org_created_at_id_idx" ON "core_outbox_events"("organization_id", "created_at", "id");
DROP INDEX "core_status_transitions_created_at_id_idx";
CREATE INDEX "core_status_transitions_org_created_at_id_idx" ON "core_status_transitions"("organization_id", "created_at", "id");
DROP INDEX "core_webhook_inbox_received_at_idx";
CREATE INDEX "core_webhook_inbox_org_received_at_idx" ON "core_webhook_inbox"("organization_id", "received_at", "id");
CREATE INDEX "core_refunds_org_id_idx" ON "core_refunds"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "core_payments" ADD CONSTRAINT "core_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_payment_transactions" ADD CONSTRAINT "core_payment_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_refunds" ADD CONSTRAINT "core_refunds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_gateway_raw_responses" ADD CONSTRAINT "core_gateway_raw_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_idempotency_keys" ADD CONSTRAINT "core_idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_outbox_events" ADD CONSTRAINT "core_outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_webhook_inbox" ADD CONSTRAINT "core_webhook_inbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "core_status_transitions" ADD CONSTRAINT "core_status_transitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
