# 06: Publishable Keys

**What to build:** An Organization Admin creates Publishable Keys: public keys that let Customers' browsers, on the Organization's allowed websites, use checkout endpoints and nothing else (ADR 0009). They live in identity next to API Keys. See the [spec](../spec.md) (Publishable Key).

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] An Organization Admin creates a Publishable Key with a label and a list of allowed origins (scheme, host and port).
  - At least one origin is required.
  - `localhost` origins are accepted only outside production.
- [ ] The key has a recognisable prefix distinct from API Keys. Because it is not secret, it can be shown again at any time.
- [ ] An Organization Admin lists keys, edits their allowed origins and revokes them. Several active keys can exist at once, and a revoked key fails on the next request.
- [ ] Identity resolves a Publishable Key into a checkout-only principal carrying its Organization and allowed origins.
- [ ] Credentials are not interchangeable:
  - the payments API and Console endpoints refuse a Publishable Key;
  - checkout endpoints refuse an API Key;
  - this is enforced by a guard that the checkout endpoints in 07 and 08 will use.
- [ ] A request with an `Origin` outside the key's allowed origins is refused. So is a request with no `Origin`.
- [ ] A key of a suspended Organization is refused.
- [ ] Operators are refused on every write. Writes are sensitive writes. Super Admin writes are labelled as the platform.
- [ ] The Console has a Publishable Keys page in Organization settings.
- [ ] The seed creates a Publishable Key allowing a local origin.
- [ ] Integration tests cover creation, origin validation, revocation, refusing each credential where the other is expected, origin enforcement, suspension and isolation. A test-only endpoint behind the guard is enough to exercise it before 07 exists.
