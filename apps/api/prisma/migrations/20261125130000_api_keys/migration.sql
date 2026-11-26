-- API Keys (ticket 09): an Organization's credential for the public payments API.

CREATE TABLE "iam_api_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "iam_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iam_api_keys_key_hash_key" ON "iam_api_keys"("key_hash");
CREATE INDEX "iam_api_keys_organization_id_idx" ON "iam_api_keys"("organization_id");

ALTER TABLE "iam_api_keys" ADD CONSTRAINT "iam_api_keys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
