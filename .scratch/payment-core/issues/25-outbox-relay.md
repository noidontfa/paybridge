# 25: Outbox relay to BullMQ

Status: resolved

**What to build:** Domain events written to the outbox reach BullMQ. A Redis outage delays delivery but loses nothing. Delivery is at least once, and each job is identified by its outbox row, so consumers can deduplicate.

**Blocked by:** 10: Transaction runner, repositories and queue connection; 12: Create Payment

- [x] The relay reads unpublished outbox rows and adds each one to BullMQ with the outbox row id as the job id, then sets the published time.
- [x] While Redis is unavailable, rows stay unpublished and nothing is lost. Publishing resumes when Redis returns.
- [x] If the process stops after enqueuing and before marking a row published, the row is enqueued again. The job id prevents a duplicate job.
- [x] Published rows are not deleted here (deletion is ticket 27).
- [x] Every Payment-level event type goes through the same path.
- [x] No consumer code is written; the relay only dispatches.
