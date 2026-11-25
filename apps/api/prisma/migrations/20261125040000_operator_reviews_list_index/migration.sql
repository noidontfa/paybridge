-- Operator Reviews list (GET /internal/reviews): keyset paging by the time the
-- Review opened.

-- CreateIndex
CREATE INDEX "core_payment_transactions_review_opened_idx" ON "core_payment_transactions"("review_opened_at", "id");
