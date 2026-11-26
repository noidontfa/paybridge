# 06: Invitations

**What to build:** An Organization Admin invites people by email with a Role, and the invitee sets their own password from the link. The same flow lets a Super Admin invite an Organization Admin into any Organization. See the [spec](../spec.md) (Invitations).

**Blocked by:** 03, 05

**Status:** done

- [x] An Organization Admin invites an email as Operator or Organization Admin into their own Organization; a Super Admin can do so in any Organization
- [x] The Invitation email goes through the email port; in development its link appears in the console log
- [x] Accepting sets the password (at least 12 characters) and creates an active User with that Role and Organization
- [x] An Invitation link is single-use, expires after 7 days and is stored hashed
- [x] Re-sending voids the previous link; revoking a pending Invitation stops its link working
- [x] Inviting an email that already belongs to a User is refused
- [x] Organization Admins can list pending Invitations with Role and expiry
- [x] All Invitation management is a sensitive write
- [x] The Console has an accept-Invitation page and Invitation management in Organization settings
- [x] The seed includes a pending Invitation
- [x] Integration tests read the link from the recording email adapter and cover send, accept, expiry, re-send, revoke, duplicate email and Permission refusals
