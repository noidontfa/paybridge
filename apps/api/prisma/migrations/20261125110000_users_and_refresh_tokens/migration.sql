-- Users, refresh tokens and the acting Role on status transitions (ticket 04).

CREATE TYPE "iam_user_role" AS ENUM ('SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'OPERATOR');

CREATE TABLE "iam_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "iam_user_role" NOT NULL,
    "organization_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "iam_users_pkey" PRIMARY KEY ("id"),
    -- A Super Admin belongs to no Organization; everyone else to exactly one.
    CONSTRAINT "iam_users_role_organization_check"
      CHECK (("role" = 'SUPER_ADMIN') = ("organization_id" IS NULL)),
    CONSTRAINT "iam_users_email_lowercase_check" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "iam_users_email_key" ON "iam_users"("email");
CREATE INDEX "iam_users_organization_id_idx" ON "iam_users"("organization_id");

ALTER TABLE "iam_users" ADD CONSTRAINT "iam_users_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "iam_organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "iam_refresh_tokens" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "iam_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iam_refresh_tokens_token_hash_key" ON "iam_refresh_tokens"("token_hash");
CREATE INDEX "iam_refresh_tokens_family_id_idx" ON "iam_refresh_tokens"("family_id");
CREATE INDEX "iam_refresh_tokens_user_id_idx" ON "iam_refresh_tokens"("user_id");

ALTER TABLE "iam_refresh_tokens" ADD CONSTRAINT "iam_refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "iam_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "core_status_transitions" ADD COLUMN "actor_role" TEXT;
