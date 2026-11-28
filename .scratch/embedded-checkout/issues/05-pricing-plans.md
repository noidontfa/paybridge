# 05: Pricing Plans

**What to build:** An Organization Admin defines what the Organization sells as Pricing Plans in the Console: name, description, features, an Amount in VND, allowed PaymentGateways, return URLs and Payment Expiry. Pricing Plans live in a new checkout module with its own table prefix. Nothing can buy them yet; 07 does that. See the [spec](../spec.md) (Pricing Plan).

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] An Organization Admin creates a Pricing Plan with:
  - a name and a description;
  - an ordered list of feature lines, each plain text marked included or not included, capped at about 10;
  - an Amount (decimal VND);
  - allowed PaymentGateway ids, where empty means every enabled one;
  - an optional success URL and cancel URL, HTTPS outside development;
  - a Payment Expiry duration, validated against the existing range of 30 minutes to 24 hours, with a default of 30 minutes.
- [ ] An Organization Admin edits every field at any time.
- [ ] An Organization Admin archives a Pricing Plan and restores an archived one.
- [ ] A Pricing Plan can be deleted only if no Payment references it. The rule is enforced now and becomes reachable once 07 links Payments.
- [ ] Archiving returns the Pricing Tables that include the Pricing Plan. The list is empty until 08 exists. The Console shows it as a warning before archiving.
- [ ] Operators can list and view Pricing Plans but are refused on every write. Super Admin writes are labelled as the platform. New Permissions are defined in code and checked by Permission.
- [ ] Every query is scoped to the principal's Organization. The isolation and architecture checks cover the new module.
- [ ] The Console has a Pricing Plans list and editor.
- [ ] The seed creates a few Pricing Plans in two Organizations, including an archived one.
- [ ] Integration tests cover validation, editing, archive and restore, delete rules, Permissions per Role and isolation. A Console e2e spec covers creating and editing a Pricing Plan.
