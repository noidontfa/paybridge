# 03: Email port with console-log adapter

**What to build:** PayBridge can send an email through one port, given a recipient, a subject, a body and the action link. In development and tests the adapter writes the recipient, subject and full link to the console log, so a developer can copy an Invitation or Password Reset link and follow it. Tests can swap in a recording adapter through dependency injection. See the [spec](../spec.md) (Email port).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] An email-sending port lives in the `identity` module (creating the module's skeleton if ticket 02 has not landed yet, without its tables)
- [ ] The console-log adapter logs recipient, subject and the full link in one readable entry, and is the adapter used in development
- [ ] A recording adapter can replace it in integration tests through dependency injection, the same way tests already replace the Stripe HTTP client, and exposes the emails it received
- [ ] A small test shows the console-log adapter logs recipient, subject and link
- [ ] No real email provider is added
