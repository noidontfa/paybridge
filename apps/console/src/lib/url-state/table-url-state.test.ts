import { describe, expect, it } from 'vitest';
import {
  changeTableUrlState,
  parseTableUrlState,
  tableUrlStateToSearchParams,
  type TableUrlConfig,
} from './table-url-state';

const config: TableUrlConfig = {
  filters: ['status', 'gatewayId', 'createdFrom', 'createdTo'],
  sortable: ['createdAt', 'amount'],
  defaultSort: { id: 'createdAt', desc: true },
};

const parse = (query: string) => parseTableUrlState(new URLSearchParams(query), config);

describe('parseTableUrlState', () => {
  it('gives the defaults for an empty query', () => {
    expect(parse('')).toEqual({ q: '', filters: {}, sort: { id: 'createdAt', desc: true }, cursor: null });
  });

  it('reads search, filters, sort and cursor', () => {
    expect(parse('q=order-12&status=PENDING&gatewayId=stripe&sort=amount&order=asc&cursor=abc')).toEqual({
      q: 'order-12',
      filters: { status: 'PENDING', gatewayId: 'stripe' },
      sort: { id: 'amount', desc: false },
      cursor: 'abc',
    });
  });

  it('ignores unknown params, empty values and an unknown sort column', () => {
    expect(parse('foo=bar&status=&sort=bogus&order=asc')).toEqual({
      q: '',
      filters: {},
      sort: { id: 'createdAt', desc: true },
      cursor: null,
    });
  });

  it('treats a bad order as descending', () => {
    expect(parse('sort=amount&order=sideways').sort).toEqual({ id: 'amount', desc: true });
  });
});

describe('tableUrlStateToSearchParams', () => {
  it('leaves out everything that is a default', () => {
    expect(tableUrlStateToSearchParams(parse(''), config).toString()).toBe('');
  });

  it('round-trips a full state', () => {
    const query = 'q=x&status=SUCCEEDED&createdFrom=2026-11-01&sort=amount&order=asc&cursor=c1';
    const state = parse(query);
    expect(parse(tableUrlStateToSearchParams(state, config).toString())).toEqual(state);
  });

  it('writes the direction whenever a non-default sort is set', () => {
    const params = tableUrlStateToSearchParams({ ...parse(''), sort: { id: 'amount', desc: true } }, config);
    expect(params.get('sort')).toBe('amount');
    expect(params.get('order')).toBe('desc');
  });
});

describe('changeTableUrlState', () => {
  const base = parse('status=PENDING&cursor=c1&sort=amount&order=asc');

  it('resets the cursor when a filter changes', () => {
    const next = changeTableUrlState(base, { filters: { status: 'SUCCEEDED' } });
    expect(next.filters).toEqual({ status: 'SUCCEEDED' });
    expect(next.cursor).toBeNull();
  });

  it('clears a filter with an empty value', () => {
    expect(changeTableUrlState(base, { filters: { status: '' } }).filters).toEqual({});
  });

  it('resets the cursor when the search or the sort changes', () => {
    expect(changeTableUrlState(base, { q: 'abc' }).cursor).toBeNull();
    expect(changeTableUrlState(base, { sort: { id: 'createdAt', desc: false } }).cursor).toBeNull();
  });

  it('keeps the cursor when only the cursor is set', () => {
    expect(changeTableUrlState(base, { cursor: 'c2' }).cursor).toBe('c2');
  });
});
