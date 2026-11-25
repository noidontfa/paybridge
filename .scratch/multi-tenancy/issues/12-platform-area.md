# 12: Platform area

**What to build:** Super Admins govern the platform from a Platform area in the Console: create Organizations with their first Organization Admin, suspend and reactivate them, and manage the Super Admin team. See the [spec](../spec.md) (Organizations, User management rules).

**Blocked by:** 06, 08

**Status:** ready-for-agent

- [ ] A Super Admin creates an Organization with a name and an Invitation for its first Organization Admin
- [ ] A Super Admin suspends an Organization: its API Keys are refused, its Users cannot sign in or refresh, and its sensitive writes are refused at once; Callbacks, re-queries, reconciliation and expiry for attempts already under way are still processed
- [ ] Suspension revokes the Organization's Users' refresh tokens; a suspended Organization's User sees a clear message at sign-in
- [ ] A Super Admin reactivates a suspended Organization
- [ ] A Super Admin invites another Super Admin, and deactivates or reactivates one; deactivating the last active Super Admin is refused; a Super Admin cannot change Role
- [ ] All of these are sensitive writes needing the Organization or Super Admin management Permissions
- [ ] The Console has a Platform area for Organizations and Super Admins
- [ ] The seed includes a suspended Organization
- [ ] Integration tests over HTTP cover each action, suspension's effects on API Keys, sign-in and Callbacks, and the last-Super-Admin guard
