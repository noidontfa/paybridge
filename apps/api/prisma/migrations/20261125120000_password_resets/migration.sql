-- Password Resets (ticket 07): single-use, hashed, short-lived links.

CREATE TABLE "iam_password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "iam_password_resets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iam_password_resets_token_hash_key" ON "iam_password_resets"("token_hash");
CREATE INDEX "iam_password_resets_user_id_idx" ON "iam_password_resets"("user_id");

ALTER TABLE "iam_password_resets" ADD CONSTRAINT "iam_password_resets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "iam_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
