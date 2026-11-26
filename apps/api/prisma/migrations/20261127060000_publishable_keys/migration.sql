-- Publishable Keys (embedded checkout, ticket 06): an Organization's public key
-- for Customers' browsers on its allowed websites (ADR 0009). Not secret, so the
-- key is stored in clear. The writer of each change is kept on the row.

CREATE TABLE "iam_publishable_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "allowed_origins" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_by_role" TEXT,
    "created_by_name" TEXT,
    "updated_by_user_id" UUID,
    "updated_by_role" TEXT,
    "updated_by_name" TEXT,

    CONSTRAINT "iam_publishable_keys_pkey" PRIMARY KEY ("id"),
    -- A key without allowed origins would work nowhere (or, worse, everywhere).
    CONSTRAINT "iam_publishable_keys_allowed_origins_check"
      CHECK ("allowed_origins" IS NOT NULL AND cardinality("allowed_origins") >= 1)
);

CREATE UNIQUE INDEX "iam_publishable_keys_key_key" ON "iam_publishable_keys"("key");
CREATE INDEX "iam_publishable_keys_organization_id_idx" ON "iam_publishable_keys"("organization_id");

ALTER TABLE "iam_publishable_keys" ADD CONSTRAINT "iam_publishable_keys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
