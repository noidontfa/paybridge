import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { parseAmount } from '../../domain/amount.js';
import { Clock } from '../../domain/clock.js';
import {
  IdempotencyKeyReusedError,
  InvalidUpstreamReferenceError,
  PaymentNotFoundError,
  UpstreamReferenceExistsError,
} from '../../domain/errors.js';
import { newId } from '../../domain/ids.js';
import type { Payment } from '../../domain/payment.js';
import { resolvePaymentExpiry } from '../../domain/payment-expiry.js';
import type { IdempotencyRecord } from '../../domain/records.js';
import { INITIAL_PAYMENT_STATUS } from '../../domain/rules/payment-transitions.js';
import type { Repositories } from '../../infrastructure/prisma/repositories.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { isUniqueViolation } from '../../infrastructure/prisma/unique-violation.js';

export interface CreatePaymentInput {
  /** Decimal string in the currency's major unit (VND: whole dong). */
  readonly amount: string;
  /** ISO 4217 code. Only VND in Phase 1. */
  readonly currency: string;
  /** The caller's Upstream Reference. Unique across PayBridge, immutable. */
  readonly upstreamReference: string;
  /** Payment Expiry. Default 30 minutes after creation. */
  readonly expiresAt?: Date;
}

export interface CreatePaymentOptions {
  /**
   * The merchant's `Idempotency-Key`. Scope: one create request. Without it
   * the request is an ordinary create.
   */
  readonly idempotencyKey?: string;
}

/**
 * The Payment as it was when the create request succeeded: the domain data
 * stored with an idempotency key. It is JSON (dates as ISO strings); the HTTP
 * layer maps it to the response body.
 */
export interface PaymentSnapshot {
  readonly id: string;
  readonly status: string;
  readonly amount: string;
  readonly currency: string;
  readonly upstreamReference: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface CreatePaymentResult {
  /** The Payment as stored now (on a replay, its current state). */
  readonly payment: Payment;
  /** HTTP status of the response, stored with the key. */
  readonly status: number;
  /** The Payment as first created: the original one on a replay. */
  readonly snapshot: PaymentSnapshot;
  /** True when this is the stored response of an earlier request. */
  readonly replayed: boolean;
}

/** Idempotency records are kept 24 hours (spec: Idempotency, Retention). */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

const CREATED = 201;

/**
 * Creates a PENDING Payment (spec: Use cases, `createPayment`). One
 * transaction inserts the Payment, its first status transition, the
 * `PaymentCreated` outbox event and, with a key, the idempotency record with
 * the response. No attempt is created.
 *
 * Same key and body → the stored response; same key, other body →
 * `IdempotencyKeyReusedError`; existing upstream reference →
 * `UpstreamReferenceExistsError` with that Payment's id. Concurrent requests
 * race on the database unique constraints; the loser's transaction rolls back
 * and it resolves against the winner's committed rows.
 */
@Injectable()
export class CreatePayment {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async execute(
    input: CreatePaymentInput,
    options: CreatePaymentOptions = {},
  ): Promise<CreatePaymentResult> {
    const amount = parseAmount(input.amount, input.currency);
    const upstreamReference = input.upstreamReference;
    if (upstreamReference.trim() === '') {
      throw new InvalidUpstreamReferenceError(
        'upstreamReference must not be empty',
      );
    }
    const now = this.clock.now();
    const expiresAt = resolvePaymentExpiry(input.expiresAt, now);
    const key = options.idempotencyKey;
    const requestHash = hashRequest(input);

    if (key !== undefined) {
      const replay = await this.replayStored(key, requestHash, now);
      if (replay) return replay;
    }

    try {
      return await this.runner.run(async (repos) => {
        if (key !== undefined) {
          await repos.idempotencyKeys.deleteIfExpired(key, now);
        }
        await assertUpstreamReferenceFree(repos, upstreamReference);

        const payment = await repos.payments.create({
          id: newId(),
          merchantOrderId: upstreamReference,
          amount: amount.value,
          currency: amount.currency,
          status: INITIAL_PAYMENT_STATUS,
          expiresAt,
        });
        await repos.statusTransitions.record({
          entityType: 'PAYMENT',
          entityId: payment.id,
          fromStatus: null,
          toStatus: payment.status,
          trigger: 'create_payment',
          actor: 'merchant',
        });
        await repos.outbox.add({
          eventType: 'PaymentCreated',
          paymentId: payment.id,
          payload: {
            paymentId: payment.id,
            upstreamReference: payment.merchantOrderId,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            expiresAt: payment.expiresAt.toISOString(),
          },
        });
        const snapshot = toSnapshot(payment);
        if (key !== undefined) {
          await repos.idempotencyKeys.create({
            key,
            requestHash,
            responseStatus: CREATED,
            responseBody: snapshot,
            paymentId: payment.id,
            createdAt: now,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_KEY_TTL_MS),
          });
        }
        return { payment, status: CREATED, snapshot, replayed: false };
      });
    } catch (error) {
      const lostRace =
        isUniqueViolation(error) ||
        error instanceof UpstreamReferenceExistsError;
      if (!lostRace) throw error;
      // A concurrent request committed first: answer as if we came second.
      if (key !== undefined) {
        const replay = await this.replayStored(key, requestHash, now);
        if (replay) return replay;
      }
      await assertUpstreamReferenceFree(
        this.runner.repositories,
        upstreamReference,
      );
      throw error;
    }
  }

  /** The stored response for a live record of `key`, or null if none. */
  private async replayStored(
    key: string,
    requestHash: string,
    now: Date,
  ): Promise<CreatePaymentResult | null> {
    const repos = this.runner.repositories;
    const record = await repos.idempotencyKeys.find(key);
    if (!record || !isLive(record, now)) return null;
    if (record.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError(key);
    }
    const paymentId = record.paymentId;
    const payment = paymentId ? await repos.payments.findById(paymentId) : null;
    if (!payment) throw new PaymentNotFoundError(paymentId ?? '(none)');
    return {
      payment,
      status: record.responseStatus,
      snapshot: record.responseBody as PaymentSnapshot,
      replayed: true,
    };
  }
}

function toSnapshot(payment: Payment): PaymentSnapshot {
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    upstreamReference: payment.merchantOrderId,
    expiresAt: payment.expiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
  };
}

function isLive(record: IdempotencyRecord, now: Date): boolean {
  return record.expiresAt.getTime() > now.getTime();
}

async function assertUpstreamReferenceFree(
  repos: Repositories,
  upstreamReference: string,
): Promise<void> {
  const existingId =
    await repos.payments.findIdByUpstreamReference(upstreamReference);
  if (existingId !== null) throw new UpstreamReferenceExistsError(existingId);
}

/**
 * SHA-256 of the request's fields in a fixed order, so key order and
 * equivalent expiry offsets in the JSON body do not count as a different body.
 */
export function hashRequest(input: CreatePaymentInput): string {
  const canonical = JSON.stringify([
    input.amount,
    input.currency,
    input.upstreamReference,
    input.expiresAt?.toISOString() ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
