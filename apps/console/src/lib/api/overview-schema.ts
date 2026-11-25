/**
 * `GET /internal/overview?range=24h|7d|30d`: the operator Overview. Copied
 * into the Console like every response type (ADR 0004); it is also the shape
 * the backend admin read API must provide.
 *
 * Definitions: Payments are counted and bucketed by creation time. `volume` is
 * the sum of the Amounts of the range's succeeded Payments (no revenue or fee).
 * `successRate` is succeeded over closed (succeeded, cancelled, expired)
 * Payments, from 0 to 1, or null when none is closed. A gateway row belongs to
 * the PaymentGateway of the Payment's latest PaymentTransaction.
 */
import { z } from 'zod';
import { OVERVIEW_RANGES } from '@/lib/overview-range';
import { decimalStringSchema, paymentStatusSchema } from './schemas';

const rateSchema = z.number().min(0).max(1).nullable();

export const overviewSchema = z.object({
  range: z.enum(OVERVIEW_RANGES),
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  volume: decimalStringSchema,
  paymentCount: z.number().int().nonnegative(),
  successRate: rateSchema,
  openReviewCount: z.number().int().nonnegative(),
  /** Oldest first: 24 hourly buckets for `24h`, daily buckets for `7d` and `30d`. */
  volumeSeries: z.array(z.object({ start: z.string(), volume: decimalStringSchema })),
  statusCounts: z.array(z.object({ status: paymentStatusSchema, count: z.number().int().nonnegative() })),
  gateways: z.array(
    z.object({
      gatewayId: z.string(),
      count: z.number().int().nonnegative(),
      volume: decimalStringSchema,
      successRate: rateSchema,
    }),
  ),
  /** Newest first. */
  recentPayments: z.array(
    z.object({
      id: z.string(),
      upstreamReference: z.string(),
      amount: decimalStringSchema,
      status: paymentStatusSchema,
      /** Null while no PaymentTransaction exists. */
      gatewayId: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type Overview = z.infer<typeof overviewSchema>;
