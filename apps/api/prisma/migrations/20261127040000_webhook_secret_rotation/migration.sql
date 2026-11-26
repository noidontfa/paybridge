-- Webhooks (embedded-checkout ticket 04): rolling a Webhook Endpoint's signing
-- secret. The previous secret keeps signing until its end time, and every roll
-- is recorded with who made it.

-- AlterTable
ALTER TABLE "wh_endpoints" ADD COLUMN     "previous_secret_ciphertext" TEXT,
ADD COLUMN     "previous_secret_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "previous_secret_key_id" TEXT;

-- CreateTable
CREATE TABLE "wh_secret_rolls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "rolled_at" TIMESTAMPTZ(3) NOT NULL,
    "previous_secret_expires_at" TIMESTAMPTZ(3),
    "rolled_by_user_id" UUID NOT NULL,
    "rolled_by_role" TEXT NOT NULL,
    "rolled_by_name" TEXT NOT NULL,

    CONSTRAINT "wh_secret_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wh_secret_rolls_endpoint_idx" ON "wh_secret_rolls"("endpoint_id", "rolled_at");

-- AddForeignKey
ALTER TABLE "wh_secret_rolls" ADD CONSTRAINT "wh_secret_rolls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wh_secret_rolls" ADD CONSTRAINT "wh_secret_rolls_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "wh_endpoints"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
