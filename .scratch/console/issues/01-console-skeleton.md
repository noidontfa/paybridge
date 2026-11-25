# 01: Console skeleton: sidebar, themes, Settings and CI

**What to build:** A developer runs the PayBridge Console (`@paybridge/console`) from the monorepo and sees the application shell built from the shadcn **sidebar-08** block (Base UI flavour): the header "PayBridge Console", every navigation item from the spec, the secondary nav and the Operator user menu in the footer. Every page except Refunds exists as a placeholder with a breadcrumb. The Operator can switch light, dark and system themes, collapse the sidebar, and use it as a drawer on a phone. Settings already works: theme and table density are remembered in the browser, and a read-only Environment panel shows the API base URL, whether mock mode is on, and the build version. The Console is held to the same standard as the API: it builds, lints, typechecks and runs its tests in turbo and in CI.

See [spec](../spec.md): Navigation and layout, Settings, Platform and quality; Implementation Decisions › Application, Sidebar, Routing.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Next.js App Router app with strict TypeScript extends the shared TypeScript config and is in the pnpm workspace.
- [ ] Tailwind and shadcn/ui are installed with the Base UI flavour; the layout starts from the official sidebar-08 block and is adapted, not replaced.
- [ ] Sidebar: Overview; Payments group (Payments, Exceptions); Refunds disabled and marked "Soon" with no route; Gateways; Developers group (Callbacks, Events, Audit log); secondary nav Settings and Docs; footer user menu with the theme switch.
- [ ] The active nav item is highlighted; the sidebar collapses on desktop and opens as a drawer at phone width with no horizontal page scroll.
- [ ] Each placeholder page has a page header with breadcrumb.
- [ ] Theme (light, dark, system) is applied without a flash on load and is consistent across shadcn components.
- [ ] Settings stores theme and table density in browser storage, read defensively (works when storage is unavailable).
- [ ] The Environment panel shows server-provided values only; the API base URL is never bundled into client code.
- [ ] `dev`, `build`, `lint`, `typecheck`, `test` and `test:e2e` run through turbo, and CI runs them for the Console.
- [ ] Vitest with Testing Library (jsdom) and Playwright are configured; one Playwright smoke test opens the Console, navigates through the sidebar and switches theme.
- [ ] Every control in the shell is reachable by keyboard and labelled.
