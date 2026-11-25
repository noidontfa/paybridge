-- Operator Developers pages (GET /internal/payment-events and
-- GET /internal/status-transitions): keyset paging by creation time, newest
-- first. The Callbacks list pages by received time, which is already indexed.

-- CreateIndex
CREATE INDEX "core_outbox_events_created_at_id_idx" ON "core_outbox_events"("created_at", "id");

-- CreateIndex
CREATE INDEX "core_status_transitions_created_at_id_idx" ON "core_status_transitions"("created_at", "id");
