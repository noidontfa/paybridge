import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/organization-scope.js';
import {
  ReviewsReadRepository,
  type ReviewListFilters,
  type ReviewRow,
} from '../../../infrastructure/prisma/console-read/reviews-read.repository.js';
import { encodeCursor, toPage, type Page } from './cursor.js';

export interface ListReviewsInput {
  readonly filters: ReviewListFilters;
  readonly order: 'asc' | 'desc';
  readonly limit: number;
  /** Decoded cursor tail: opening time (ISO) and id. */
  readonly after?: { readonly value: string; readonly id: string };
}

/** Hours a Review stays open before an Operator may resolve it. */
export const REVIEW_RESOLVABLE_AFTER_HOURS = 72;

export interface ReviewItem extends ReviewRow {
  readonly resolvableAt: Date;
}

/**
 * The operator Reviews list (`GET /internal/reviews`). Read only: no
 * transaction, no writes (ADR 0005).
 */
@Injectable()
export class ListReviews {
  constructor(
    @Inject(ReviewsReadRepository)
    private readonly reviews: ReviewsReadRepository,
  ) {}

  async execute(
    scope: ReadScope,
    input: ListReviewsInput,
  ): Promise<Page<ReviewItem>> {
    const rows = await this.reviews.list(scope, input);
    const page = toPage(rows, input.limit, (last) =>
      encodeCursor([
        `reviewOpenedAt:${input.order}`,
        last.reviewOpenedAt.toISOString(),
        last.id,
      ]),
    );
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => ({
        ...row,
        resolvableAt: new Date(
          row.reviewOpenedAt.getTime() +
            REVIEW_RESOLVABLE_AFTER_HOURS * 3_600_000,
        ),
      })),
    };
  }
}
