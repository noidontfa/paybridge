# 05: Overview

**What to build:** `GET /internal/overview?range=24h|7d|30d`, so the Console's Overview shows real figures. The definitions are in the [map](../map.md) and the Console's overview schema header.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Returns volume, Payment count, success rate (succeeded over closed Payments, null when none is closed), open Review count, volume series, counts by Payment status, per-gateway breakdown and recent Payments, for each of the three ranges
- [ ] Buckets are rolling and counted back from the end of the range: 24 hourly buckets for `24h`, 24-hour buckets for `7d` and `30d`
- [ ] Volume sums the Amounts of the range's succeeded Payments, as a decimal string
- [ ] A Payment is attributed to the gateway of its latest PaymentTransaction, so the Payment that switched gateway is counted once under the last gateway
- [ ] An invalid range is rejected with the API's standard error response; a range with no Payments returns zeros and a null success rate
- [ ] Aggregates run in the database through a read-model repository, with no transaction and no writes
- [ ] Integration tests validate the response against the copied Console schema and check bucket counts, success rate (including null), volume and per-gateway attribution on seeded data
- [ ] The Console's Overview, with mocks turned off, shows seeded data for every range
