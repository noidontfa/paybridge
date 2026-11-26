-- Webhooks (embedded-checkout ticket 01): Webhook Endpoints, the delivery of
-- each Payment Event to each subscribed endpoint, and every delivery attempt.
-- One delivery per (event, endpoint), so consuming an event twice is a no-op.

-- CreateEnum
CREATE TYPE "wh_endpoint_status" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "wh_delivery_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "wh_endpoints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "event_kinds" TEXT[],
    "status" "wh_endpoint_status" NOT NULL DEFAULT 'ENABLED',
    "secret_ciphertext" TEXT NOT NULL,
    "secret_key_id" TEXT NOT NULL,
    "secret_prefix" TEXT NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "updated_by_role" TEXT NOT NULL,
    "updated_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "wh_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wh_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_kind" TEXT NOT NULL,
    "event_created_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "wh_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wh_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wh_delivery_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "response_body" TEXT,
    "error" TEXT,

    CONSTRAINT "wh_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wh_endpoints_organization_id_idx" ON "wh_endpoints"("organization_id");

-- CreateIndex
CREATE INDEX "wh_deliveries_organization_created_idx" ON "wh_deliveries"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "wh_deliveries_endpoint_id_idx" ON "wh_deliveries"("endpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "wh_deliveries_event_endpoint_uq" ON "wh_deliveries"("event_id", "endpoint_id");

-- CreateIndex
CREATE INDEX "wh_delivery_attempts_delivery_idx" ON "wh_delivery_attempts"("delivery_id", "attempted_at");

-- AddForeignKey
ALTER TABLE "wh_endpoints" ADD CONSTRAINT "wh_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wh_deliveries" ADD CONSTRAINT "wh_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wh_deliveries" ADD CONSTRAINT "wh_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "wh_endpoints"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wh_delivery_attempts" ADD CONSTRAINT "wh_delivery_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wh_delivery_attempts" ADD CONSTRAINT "wh_delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "wh_deliveries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
