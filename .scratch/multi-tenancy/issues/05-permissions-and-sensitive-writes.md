# 05: Permissions, sensitive writes and Super Admin in an Organization

**What to build:** What a User can do is decided by Permission. Operators view and resolve Reviews; Organization Admins can do everything an Operator does; Super Admins can act in any Organization, with their actions labelled as the platform's. Sensitive writes re-check the User, Role and Organization in the database so revocation blocks them at once. See the [spec](../spec.md) (Permissions, Sensitive writes, Console).

**Blocked by:** 04

**Status:** done

- [x] A fixed Role-to-Permission map in code covers: view Payment data, resolve Review, manage Users, manage API Keys, manage Gateway Connections, manage Organizations, manage Super Admins
- [x] Every `/internal` route checks a named Permission, never a Role name; missing Permission is refused with the standard error envelope
- [x] Resolving a Review is a sensitive write: it re-reads in the database that the User is active, still holds the Role, and that the Organization is not suspended, and is refused at once otherwise
- [x] A Super Admin can read with one chosen Organization or with "all Organizations"; every write requires exactly one chosen Organization
- [x] A Super Admin can resolve a Review in any Organization with a note; operator read models label it "Super Admin (PayBridge)" with the User's name
- [x] The Console hides or disables actions the signed-in User has no Permission for
- [x] The Console gives Super Admins an Organization switcher and an "All Organizations" read view
- [x] Integration tests over HTTP cover every Permission for each Role, the refusals, the Super Admin scope rules, and the immediate refusal of a sensitive write after the User is deactivated or the Organization suspended (set directly in the test)
