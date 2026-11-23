# 27: Retention deletes

Status: ready-for-agent

**What to build:** Scheduled cleanup removes rows that the spec allows to expire, and only those. Audit data, raw gateway responses, unpublished outbox rows and `FAILED` inbox rows are never removed automatically.

**Blocked by:** 13: Idempotency-Key on create; 18: Verified webhook intake; 25: Outbox relay to BullMQ

- [ ] Idempotency records are deleted 24 hours after their expiry time.
- [ ] Published outbox rows are deleted 7 days after publication.
- [ ] Webhook inbox rows are deleted 90 days after receipt, except rows in `FAILED`.
- [ ] Unpublished outbox rows are never deleted. A test checks this.
- [ ] `FAILED` inbox rows are never deleted automatically. A test checks this.
- [ ] Raw gateway responses and status transitions are never deleted.
- [ ] The cleanup runs as one repeatable schedule across instances.
