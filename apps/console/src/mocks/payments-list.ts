/**
 * The mocked `GET /internal/payments`. The store does the filtering, sorting
 * and paging; this module turns a query string into that and back. A cursor
 * is opaque to the Console (here it is an offset in base64), and every
 * list handler can reuse `readListWindow` / `pageOf` for the same envelope.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { compareDecimal } from '@/utils/decimal';
import type { PaymentListItem } from '@/features/payments/api';
import { PAYMENT_SORT_COLUMNS } from '@/features/payments/api';
import type { MockStore } from './store';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class BadQueryError extends Error {}

/** Reads `cursor` and `limit`; throws `BadQueryError` for values the API would reject. */
export function readListWindow(params: URLSearchParams): { offset: number; limit: number } {
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadQueryError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  const cursor = params.get('cursor');
  if (cursor === null) return { offset: 0, limit };
  try {
    const offset = Number(atob(cursor));
    if (Number.isInteger(offset) && offset >= 0) return { offset, limit };
  } catch {
    // falls through to the error below
  }
  throw new BadQueryError('cursor is not valid');
}

export function pageOf<T>(rows: T[], { offset, limit }: { offset: number; limit: number }) {
  const end = offset + limit;
  return { items: rows.slice(offset, end), nextCursor: end < rows.length ? btoa(String(end)) : null };
}

function startOfDay(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function endOfDay(day: string): number {
  return Date.parse(`${day}T23:59:59.999Z`);
}

function readDay(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  if (value === null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(startOfDay(value))) {
    throw new BadQueryError(`${name} must be a date as YYYY-MM-DD`);
  }
  return value;
}

export function queryPayments(store: MockStore, params: URLSearchParams) {
  const window = readListWindow(params);
  const status = params.get('status') || null;
  const gatewayId = params.get('gatewayId') || null;
  const pricingPlanId = params.get('pricingPlanId') || null;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const from = readDay(params, 'createdFrom');
  const to = readDay(params, 'createdTo');
  const sort = params.get('sort') ?? 'createdAt';
  if (!PAYMENT_SORT_COLUMNS.some((column) => column === sort)) {
    throw new BadQueryError(`sort must be one of ${PAYMENT_SORT_COLUMNS.join(', ')}`);
  }
  const direction = params.get('order') === 'asc' ? 1 : -1;

  const rows = store.payments
    .filter((p) => !status || p.status === status)
    .filter((p) => !gatewayId || store.attemptsOf(p.id).some((a) => a.gatewayId === gatewayId))
    .filter((p) => !pricingPlanId || p.checkoutOrigin?.pricingPlanId === pricingPlanId)
    .filter((p) => !q || p.id.toLowerCase().includes(q) || p.upstreamReference.toLowerCase().includes(q))
    .filter((p) => !from || Date.parse(p.createdAt) >= startOfDay(from))
    .filter((p) => !to || Date.parse(p.createdAt) <= endOfDay(to))
    .sort((a, b) => {
      const order =
        sort === 'amount'
          ? compareDecimal(a.amount, b.amount)
          : Date.parse(a.createdAt) - Date.parse(b.createdAt);
      // The id breaks ties so a page boundary never repeats or skips a row.
      return direction * order || (a.id < b.id ? -1 : 1);
    })
    .map(({ checkoutOrigin: _origin, ...p }): PaymentListItem => {
      const latest = store.attemptsOf(p.id).at(-1);
      return { ...p, latestTransaction: latest ? { gatewayId: latest.gatewayId, status: latest.status } : null };
    });

  return pageOf(rows, window);
}

export function paymentsListHandlers(base: string, store: MockStore, badRequest: (request: Request, message: string) => Response): HttpHandler[] {
  return [
    http.get(`${base}/internal/payments`, ({ request }) => {
      try {
        return HttpResponse.json(queryPayments(store, new URL(request.url).searchParams));
      } catch (error) {
        if (error instanceof BadQueryError) return badRequest(request, error.message);
        throw error;
      }
    }),
  ];
}
