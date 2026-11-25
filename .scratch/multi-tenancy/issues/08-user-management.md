# 08: User management

**What to build:** An Organization Admin manages the people in their Organization: list them, change their Role, deactivate and reactivate them. The Organization is never left without an Organization Admin. See the [spec](../spec.md) (User management rules).

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Organization Admins list their Organization's Users with Role and active state
- [ ] They can change a User's Role between Operator and Organization Admin, deactivate and reactivate a User
- [ ] Deactivation and Role changes revoke the User's refresh tokens: their sensitive writes are refused at once, and their reads stop within the access token's lifetime
- [ ] Demoting or deactivating the last active Organization Admin is refused
- [ ] A Super Admin can do all of this in any Organization, including appointing a new Organization Admin
- [ ] A deactivated User's past actions still show under their name
- [ ] All of these are sensitive writes
- [ ] The Console has a Users page in Organization settings
- [ ] The seed includes a deactivated User
- [ ] Integration tests over HTTP cover each action, the last-admin guard, token revocation and Permission refusals
