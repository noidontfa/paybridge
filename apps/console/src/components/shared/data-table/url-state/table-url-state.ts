/**
 * URL state for list screens: maps search params to and from table state
 * (search, filters, sort, cursor). Pure; the hook that talks to the Next.js
 * router is in `use-table-url-state.ts`.
 *
 * Params: `q`, one param per filter, `sort` plus `order` (`asc` or `desc`),
 * `cursor`. Defaults are left out of the URL so a plain `/payments` stays
 * plain. Extension point: a new list declares its own `TableUrlConfig`.
 */

export interface SortState {
  id: string;
  desc: boolean;
}

export interface TableUrlConfig {
  /** Names of the filter params this list understands. */
  filters: readonly string[];
  /** Column ids the server can sort by. */
  sortable: readonly string[];
  defaultSort: SortState;
}

export interface TableUrlState {
  q: string;
  filters: Record<string, string>;
  sort: SortState;
  /** Where the first page starts; null for the first page. */
  cursor: string | null;
}

interface ParamsReader {
  get(name: string): string | null;
}

export function parseTableUrlState(params: ParamsReader, config: TableUrlConfig): TableUrlState {
  const filters: Record<string, string> = {};
  for (const name of config.filters) {
    const value = params.get(name);
    if (value) filters[name] = value;
  }

  const sortId = params.get('sort');
  let sort = config.defaultSort;
  if (sortId && config.sortable.includes(sortId)) {
    sort = { id: sortId, desc: params.get('order') !== 'asc' };
  }

  return { q: params.get('q') ?? '', filters, sort, cursor: params.get('cursor') || null };
}

export function tableUrlStateToSearchParams(state: TableUrlState, config: TableUrlConfig): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const name of config.filters) {
    const value = state.filters[name];
    if (value) params.set(name, value);
  }
  if (state.sort.id !== config.defaultSort.id || state.sort.desc !== config.defaultSort.desc) {
    params.set('sort', state.sort.id);
    params.set('order', state.sort.desc ? 'desc' : 'asc');
  }
  if (state.cursor) params.set('cursor', state.cursor);
  return params;
}

export interface TableUrlPatch {
  q?: string;
  /** Merged into the current filters; an empty value clears one. */
  filters?: Record<string, string>;
  sort?: SortState;
  cursor?: string | null;
}

/** Applies a change. Anything but the cursor itself sends the view back to the first page. */
export function changeTableUrlState(state: TableUrlState, patch: TableUrlPatch): TableUrlState {
  const filters = { ...state.filters };
  for (const [name, value] of Object.entries(patch.filters ?? {})) {
    if (value) filters[name] = value;
    else delete filters[name];
  }
  return {
    q: patch.q ?? state.q,
    filters,
    sort: patch.sort ?? state.sort,
    cursor: patch.cursor ?? null,
  };
}
