-- Operator Payments list (GET /internal/payments): keyset paging by creation
-- time or amount, the latest attempt of each Payment, and the gateway filter.
-- Later operator endpoints add their own indexes in their own migrations.

-- CreateIndex
CREATE INDEX "core_payments_created_at_id_idx" ON "core_payments"("created_at", "id");

-- CreateIndex
CREATE INDEX "core_payments_amount_id_idx" ON "core_payments"("amount", "id");

-- CreateIndex
CREATE INDEX "core_payment_transactions_payment_created_idx" ON "core_payment_transactions"("payment_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "core_payment_transactions_gateway_payment_idx" ON "core_payment_transactions"("gateway_id", "payment_id");
