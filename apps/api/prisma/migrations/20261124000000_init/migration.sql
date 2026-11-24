-- CreateEnum
CREATE TYPE "core_payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "core_payment_transaction_status" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "core_review_reason" AS ENUM ('AMBIGUOUS_PROVIDER_STATUS', 'AMOUNT_MISMATCH', 'LATE_SUCCESS_ON_CLOSED_PAYMENT', 'DUPLICATE_SUCCESS');

-- CreateEnum
CREATE TYPE "core_refund_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_ACTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "core_gateway_operation" AS ENUM ('initiate', 'query', 'cancel');

-- CreateEnum
CREATE TYPE "core_outbox_event_type" AS ENUM ('PaymentCreated', 'PaymentSucceeded', 'PaymentCancelled', 'PaymentExpired', 'PaymentRequiresReview');

-- CreateEnum
CREATE TYPE "core_webhook_inbox_status" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "core_status_transition_entity_type" AS ENUM ('PAYMENT', 'PAYMENT_TRANSACTION', 'REFUND');

-- CreateTable
CREATE TABLE "core_payments" (
    "id" UUID NOT NULL,
    "merchant_order_id" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "core_payment_status" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_payment_transactions" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "gateway_id" TEXT NOT NULL,
    "status" "core_payment_transaction_status" NOT NULL,
    "provider_ref" TEXT,
    "provider_metadata" JSONB,
    "next_action" JSONB,
    "review_reason" "core_review_reason",
    "review_opened_at" TIMESTAMPTZ(3),
    "refund_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_refunds" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "status" "core_refund_status" NOT NULL,
    "provider_ref" TEXT,
    "provider_metadata" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_gateway_raw_responses" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "operation" "core_gateway_operation" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_gateway_raw_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_idempotency_keys" (
    "key" VARCHAR(255) NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "core_outbox_events" (
    "id" UUID NOT NULL,
    "event_type" "core_outbox_event_type" NOT NULL,
    "payment_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "core_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_webhook_inbox" (
    "id" UUID NOT NULL,
    "gateway_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "provider_event_id" TEXT,
    "attempt_key" UUID,
    "raw_body" BYTEA NOT NULL,
    "headers" JSONB NOT NULL,
    "query" JSONB NOT NULL,
    "status" "core_webhook_inbox_status" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "core_webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_status_transitions" (
    "id" UUID NOT NULL,
    "entity_type" "core_status_transition_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_payments_merchant_order_id_uq" ON "core_payments"("merchant_order_id");

-- CreateIndex
CREATE INDEX "core_payments_pending_expiry_idx" ON "core_payments"("status", "expires_at") WHERE ("status" = 'PENDING');

-- CreateIndex
CREATE INDEX "core_payment_transactions_payment_id_idx" ON "core_payment_transactions"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_payment_transactions_gateway_provider_ref_uq" ON "core_payment_transactions"("gateway_id", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "core_payment_transactions_one_open_uq" ON "core_payment_transactions"("payment_id") WHERE (status = ANY (ARRAY['CREATED'::core_payment_transaction_status, 'PENDING'::core_payment_transaction_status]));

-- CreateIndex
CREATE UNIQUE INDEX "core_payment_transactions_one_succeeded_uq" ON "core_payment_transactions"("payment_id") WHERE ("status" = 'SUCCEEDED');

-- CreateIndex
CREATE INDEX "core_refunds_attempt_id_idx" ON "core_refunds"("attempt_id");

-- CreateIndex
CREATE INDEX "core_gateway_raw_responses_attempt_created_idx" ON "core_gateway_raw_responses"("attempt_id", "created_at");

-- CreateIndex
CREATE INDEX "core_idempotency_keys_expires_at_idx" ON "core_idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "core_outbox_events_unpublished_idx" ON "core_outbox_events"("id") WHERE (published_at IS NULL);

-- CreateIndex
CREATE INDEX "core_outbox_events_published_at_idx" ON "core_outbox_events"("published_at");

-- CreateIndex
CREATE INDEX "core_webhook_inbox_processing_locked_idx" ON "core_webhook_inbox"("locked_at") WHERE ("status" = 'PROCESSING');

-- CreateIndex
CREATE INDEX "core_webhook_inbox_pending_received_idx" ON "core_webhook_inbox"("received_at") WHERE (status = ANY (ARRAY['RECEIVED'::core_webhook_inbox_status, 'FAILED'::core_webhook_inbox_status]));

-- CreateIndex
CREATE INDEX "core_webhook_inbox_received_at_idx" ON "core_webhook_inbox"("received_at");

-- CreateIndex
CREATE INDEX "core_webhook_inbox_attempt_key_idx" ON "core_webhook_inbox"("attempt_key");

-- CreateIndex
CREATE UNIQUE INDEX "core_webhook_inbox_gateway_dedupe_uq" ON "core_webhook_inbox"("gateway_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "core_status_transitions_entity_idx" ON "core_status_transitions"("entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "core_payment_transactions" ADD CONSTRAINT "core_payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "core_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "core_refunds" ADD CONSTRAINT "core_refunds_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "core_payment_transactions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "core_gateway_raw_responses" ADD CONSTRAINT "core_gateway_raw_responses_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "core_payment_transactions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "core_idempotency_keys" ADD CONSTRAINT "core_idempotency_keys_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "core_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "core_outbox_events" ADD CONSTRAINT "core_outbox_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "core_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Raw SQL (not expressible in schema.prisma; Prisma does not report CHECK constraints as drift).
-- Amounts are positive (invariant 1; refunds the same).
ALTER TABLE "core_payments" ADD CONSTRAINT "core_payments_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "core_refunds" ADD CONSTRAINT "core_refunds_amount_positive" CHECK ("amount" > 0);
