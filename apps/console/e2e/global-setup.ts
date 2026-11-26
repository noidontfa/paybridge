/**
 * `next dev` compiles each route on its first request. With parallel workers
 * the first requests race with compilation and exceed the test timeout, so the
 * routes are requested once, one after the other, before any test runs. A
 * route that answers 5xx or never answers fails the run here, with its path.
 */
const ROUTES = [
  '/',
  '/payments',
  '/payments/warm-up',
  '/exceptions',
  '/gateways',
  '/gateways/stripe',
  '/callbacks',
  '/callbacks/warm-up',
  '/events',
  '/events/warm-up',
  '/audit-log',
  '/settings',
  '/docs',
  '/pricing-plans',
  '/pricing-plans/new',
  '/pricing-plans/warm-up',
  '/webhooks/deliveries',
  '/webhooks/deliveries/warm-up',
  // The BFF route handler and the mock API behind it.
  '/api/bff/internal/reviews/summary',
  '/api/bff/internal/gateways',
];

export default async function globalSetup(config: { projects: { use: { baseURL?: string } }[] }) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('global-setup: no baseURL configured');
  for (const route of ROUTES) {
    const response = await fetch(new URL(route, baseURL), { signal: AbortSignal.timeout(90_000) });
    if (response.status >= 500) throw new Error(`global-setup: warming ${route} answered ${response.status}`);
    await response.arrayBuffer();
  }
}
