# 30: Gateway contract suite and CI lint rule

Status: resolved

**What to build:** Every future Gateway Plugin passes one shared contract suite, so no plugin needs its own bespoke tests. A CI rule fails the build when Core imports a plugin, so the dependency direction is enforced, not just documented.

**Blocked by:** 11: Gateway port and Gateway Manager

- [x] One contract suite runs against any plugin, given its registration. It checks the normalised states, the error categories and their retryable flags, the callback acknowledgement format, and that capability flags match the operations available.
- [x] The fake plugin passes the suite.
- [x] A deliberately broken fake plugin that reports `EXPIRED` fails the suite.
- [x] A CI check fails when a Core module imports a plugin's code. The composition root is the only exception.
- [x] A test confirms the Core module exports no plugin types.
- [x] The rule runs in CI and fails the build on a sample violation.
