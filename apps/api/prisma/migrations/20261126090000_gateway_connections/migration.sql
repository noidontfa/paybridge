-- CreateTable
CREATE TABLE "core_gateway_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "gateway_id" TEXT NOT NULL,
    "credentials_ciphertext" TEXT,
    "credentials_key_id" TEXT,
    "credentials_version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_gateway_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_gateway_connections_org_gateway_uq" ON "core_gateway_connections"("organization_id", "gateway_id");

-- AddForeignKey
ALTER TABLE "core_gateway_connections" ADD CONSTRAINT "core_gateway_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
