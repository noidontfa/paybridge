# 30: Gateway contract suite and CI lint rule

Status: ready-for-agent

**What to build:** Every future Gateway Plugin passes one shared contract suite, so no plugin needs its own bespoke tests. A CI rule fails the build when Core imports a plugin, so the dependency direction is enforced, not just documented.

**Blocked by:** 11: Gateway port and Gateway Manager

- [ ] One contract suite runs against any plugin, given its registration. It checks the normalised states, the error categories and their retryable flags, the callback acknowledgement format, and that capability flags match the operations available.
- [ ] The fake plugin passes the suite.
- [ ] A deliberately broken fake plugin that reports `EXPIRED` fails the suite.
- [ ] A CI check fails when a Core module imports a plugin's code. The composition root is the only exception.
- [ ] A test confirms the Core module exports no plugin types.
- [ ] The rule runs in CI and fails the build on a sample violation.
