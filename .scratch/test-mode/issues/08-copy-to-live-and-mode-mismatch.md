# 08: Copy to Live, and Mode mismatch in Embedded Checkout

**What to build:** Pricing Plans and Pricing Tables are per Mode; an Organization Admin copies Test ones into Live, and an Embedded Checkout never mixes Modes. See the [spec](../spec.md) (Pricing Plans, Pricing Tables and Embedded Checkout).

**Blocked by:** 02, 03, 05

**Status:** ready-for-agent

- [ ] A "Copy to Live" action (Organization Admin, sensitive write) on a Test Pricing Plan or Pricing Table creates independent Live records; copying a table also copies its Pricing Plans that have no Live copy yet.
- [ ] A copied Pricing Plan drops allowed PaymentGateways that do not support Live (the Test Gateway).
- [ ] No Live → Test copy; editing either side never changes the other.
- [ ] Checkout endpoints look up the Pricing Table in the Publishable Key's Mode; a table in the other Mode is unavailable exactly like a deleted one.
- [ ] The snippet logs a browser-console message naming the Mode mismatch.
- [ ] Tests: copy semantics, gateway dropping, independence after copy, and mismatched key and table showing unavailable.
