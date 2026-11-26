-- Invitations (ticket 06): single-use, hashed, 7-day links to join.

CREATE TABLE "iam_invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "iam_user_role" NOT NULL,
    "organization_id" UUID,
    "invited_by_id" UUID,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "iam_invitations_pkey" PRIMARY KEY ("id"),
    -- A Super Admin belongs to no Organization; everyone else to one.
    CONSTRAINT "iam_invitations_role_organization_check"
      CHECK (("role" = 'SUPER_ADMIN') = ("organization_id" IS NULL))
);

CREATE UNIQUE INDEX "iam_invitations_token_hash_key" ON "iam_invitations"("token_hash");
CREATE INDEX "iam_invitations_organization_id_idx" ON "iam_invitations"("organization_id");
CREATE INDEX "iam_invitations_email_idx" ON "iam_invitations"("email");

ALTER TABLE "iam_invitations" ADD CONSTRAINT "iam_invitations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
