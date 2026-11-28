/**
 * `GET /internal/payments`: the operator Payments list, and
 * `GET /internal/payments/:id`: one Payment. Schemas and client functions
 * live together here; shared Payment vocabularies are in `./schemas.ts`.
 */
import { z } from 'zod';
import { INTERNAL, request } from '@/services/client';
import { listPageSchema, type ListPage, type ListQuery } from '@/services/pagination';
import {
  attemptStatusSchema,
  decimalStringSchema,
  operatorPaymentSchema,
  paymentStatusSchema,
  type OperatorPayment,
} from './schemas';

export const PAYMENT_SORT_COLUMNS = ['createdAt', 'amount'] as const;
export type PaymentSortColumn = (typeof PAYMENT_SORT_COLUMNS)[number];

/** A row of the Payments list: the Payment plus its latest PaymentTransaction. */
export const paymentListItemSchema = z.object({
  id: z.string(),
  /** Upstream Reference. */
  upstreamReference: z.string(),
  amount: decimalStringSchema,
  currency: z.string(),
  status: paymentStatusSchema,
  /** Payment Expiry. */
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Null while the Payment has no PaymentTransaction yet. */
  latestTransaction: z.object({ gatewayId: z.string(), status: attemptStatusSchema }).nullable(),
});
export type PaymentListItem = z.infer<typeof paymentListItemSchema>;

export const paymentListSchema = listPageSchema(paymentListItemSchema);
export type PaymentList = ListPage<PaymentListItem>;

export interface PaymentListQuery extends ListQuery {
  status?: string;
  gatewayId?: string;
  /** Checkout Payments of one Pricing Plan. */
  pricingPlanId?: string;
  /** Payment id or Upstream Reference. */
  q?: string;
  /** `YYYY-MM-DD`, from the start of that day. */
  createdFrom?: string;
  /** `YYYY-MM-DD`, to the end of that day. */
  createdTo?: string;
  sort?: PaymentSortColumn;
  order?: 'asc' | 'desc';
}

export function listPayments(query: PaymentListQuery, signal?: AbortSignal): Promise<PaymentList> {
  return request('/internal/payments', paymentListSchema, { query: { ...query }, signal });
}

/** `GET /internal/payments/:id`: a Payment with its attempts, transitions and events. */
export function getOperatorPayment(id: string, signal?: AbortSignal): Promise<OperatorPayment> {
  return request(`${INTERNAL}/payments/${encodeURIComponent(id)}`, operatorPaymentSchema, { signal });
}
