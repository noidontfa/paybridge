'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';
import {
  changeTableUrlState,
  parseTableUrlState,
  tableUrlStateToSearchParams,
  type TableUrlConfig,
  type TableUrlPatch,
  type TableUrlState,
} from './table-url-state';

/**
 * The URL as table state. Reading re-parses the search params; `change` writes
 * the next state back with `router.replace` (a filter change should not fill
 * the back button). `config` must be a stable (module-level) object.
 */
export function useTableUrlState(config: TableUrlConfig): {
  state: TableUrlState;
  change: (patch: TableUrlPatch) => void;
  clear: () => void;
} {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const state = useMemo(() => parseTableUrlState(searchParams, config), [searchParams, config]);

  const write = useCallback(
    (next: TableUrlState) => {
      const query = tableUrlStateToSearchParams(next, config).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [config, pathname, router],
  );

  // The router applies a write a moment later. Two changes in that gap (pick a
  // status, then a gateway) must build on each other, not on the stale URL, so
  // the state last written is kept until the URL catches up.
  const pending = useRef({ from: state, next: state });
  if (pending.current.from !== state) pending.current = { from: state, next: state };

  const apply = useCallback(
    (build: (current: TableUrlState) => TableUrlState) => {
      const next = build(pending.current.next);
      pending.current = { ...pending.current, next };
      write(next);
    },
    [write],
  );

  const change = useCallback((patch: TableUrlPatch) => apply((current) => changeTableUrlState(current, patch)), [apply]);
  // Clearing keeps the sort: it is a way of looking at the rows, not a filter.
  const clear = useCallback(
    () => apply((current) => ({ q: '', filters: {}, sort: current.sort, cursor: null })),
    [apply],
  );
  return { state, change, clear };
}
