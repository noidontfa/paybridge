# 08: Pricing Tables

**What to build:** An Organization Admin groups one to three Pricing Plans into a Pricing Table with a simple look, previews it, and copies a snippet. A public endpoint returns the Pricing Table for display on a host page. See the [spec](../spec.md) (Pricing Table, Public checkout endpoints).

**Blocked by:** 05, 06

**Status:** done

- [ ] An Organization Admin creates a Pricing Table with:
  - one to three of the Organization's Pricing Plans in order;
  - an optional recommended Pricing Plan, which must be one of them;
  - a main colour;
  - a light or dark theme;
  - a language (`vi` or `en`);
  - button text.

  Another Organization's Pricing Plan behaves as not found.
- [ ] An Organization Admin edits and deletes Pricing Tables. A Pricing Plan can sit in several Pricing Tables.
- [ ] Archiving a Pricing Plan (05) now returns the Pricing Tables that include it.
- [ ] **Public read endpoint** (Publishable Key and allowed origin). It returns the theme and, for each Pricing Plan:
  - name, Amount, description and features;
  - whether it is recommended;
  - the PaymentGateways the Customer may choose (allowed and enabled);
  - whether it can be bought now.
- [ ] When the public read endpoint cannot show anything (deleted table, suspended Organization), it returns the generic "unavailable" error with a developer reason code. An archived Pricing Plan stays in its column, marked not buyable.
- [ ] The Console has a Pricing Tables list and editor with a static preview of the cards. It generates a snippet from a chosen Publishable Key, with `data-key`, `data-table` and the optional attributes documented next to it.
- [ ] Operators can view but not change. Super Admin writes are labelled as the platform.
- [ ] Pricing Table validation (one to three plans, recommended one among them) has unit tests.
- [ ] The seed creates a Pricing Table with three Pricing Plans.
- [ ] Integration tests cover management, the public read (including archived and disabled-gateway cases), Permissions and isolation. A Console e2e spec covers building a Pricing Table and copying its snippet.
