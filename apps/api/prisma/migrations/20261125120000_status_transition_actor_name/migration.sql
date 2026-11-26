-- The acting User's name on status transitions (ticket 05).
ALTER TABLE "core_status_transitions" ADD COLUMN "actor_name" TEXT;
