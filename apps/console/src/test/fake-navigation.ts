/**
 * An in-memory stand-in for `next/navigation`, for screen tests of screens
 * whose state lives in the URL. Use it from a test with
 *
 *   vi.mock('next/navigation', async () => await import('@/test/fake-navigation'));
 *
 * and call `resetNavigation('/payments?status=PENDING')` in `beforeEach`.
 * `router.push` / `router.replace` update the fake URL (so `useSearchParams`
 * re-renders) and are recorded in `navigations`.
 */
import { useMemo, useSyncExternalStore } from 'react';

let current = new URL('http://localhost/');
const listeners = new Set<() => void>();
export const navigations: string[] = [];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function go(href: string) {
  navigations.push(href);
  current = new URL(href, 'http://localhost');
  for (const listener of listeners) listener();
}

export function resetNavigation(href = '/') {
  navigations.length = 0;
  current = new URL(href, 'http://localhost');
  for (const listener of listeners) listener();
}

/** The current fake location as `pathname + search`. */
export function currentLocation(): string {
  return current.pathname + current.search;
}

const router = { push: go, replace: go, back() {}, forward() {}, refresh() {}, prefetch() {} };

export function useRouter() {
  return router;
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => current.pathname, () => '/');
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => current.search, () => '');
  return useMemo(() => new URLSearchParams(search), [search]);
}
