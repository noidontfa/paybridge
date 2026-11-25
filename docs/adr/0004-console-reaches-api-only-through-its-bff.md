# The Console reaches the API only through its own BFF

The Operator Console (`apps/console`) never calls the NestJS API from the browser. Every request goes to Next.js Route Handlers under `apps/console/app/api/*`, which proxy to the API server-side. We chose this because Phase 1 has no authentication and protects operator routes (`/internal/*`) only by keeping them off the public ingress. A browser that calls the API directly would need `/internal` to be publicly reachable, and the API would need CORS. The cost is an extra hop and a proxy layer to maintain for every endpoint the Console uses.

## Considered Options

- **Browser calls NestJS directly** (rejected): simpler, but it exposes `/internal` to the browser and pushes the auth design onto the API before it exists.
- **Server Components fetch, client only for mutations** (rejected): it splits data access between two models and works badly with URL-synced, interactive TanStack tables.

## Consequences

- When authentication arrives, the Operator session lives in the BFF, which adds the actor identity to operator calls. A future reader should not "simplify" the Console to direct API calls without revisiting this.
- Mock mode (MSW in Node, `CONSOLE_API_MOCKS=true`) intercepts the BFF's outgoing calls, so the browser code and the BFF code are the same whether mocks are on or not.
