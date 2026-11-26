import { Inject, Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../domain/value-objects/organization-scope.js';
import { reviewResolvableAt } from '../../../domain/rules/review-resolution.js';
import {
  ReviewsReadRepository,
  type ReviewListQuery,
  type ReviewRow,
} from '../../../domain/repositories/console-read/reviews-read.repository.js';
import { isIsoTime, keysetCursor, type Page } from './keyset-cursor.js';

/** The Reviews list cursor, by opening time; it only continues its own order. */
export function reviewsCursor(order: 'asc' | 'desc') {
  return keysetCursor<ReviewRow>({
    tag: `reviewOpenedAt:${order}`,
    valueOf: (row) => row.reviewOpenedAt.toISOString(),
    isValue: isIsoTime,
    invalidMessage: 'is not valid for this list and order',
  });
}

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
    query: ReviewListQuery,
  ): Promise<Page<ReviewItem>> {
    const rows = await this.reviews.list(scope, query);
    const page = reviewsCursor(query.order).page(rows, query.limit);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => ({
        ...row,
        resolvableAt: reviewResolvableAt(row.reviewOpenedAt),
      })),
    };
  }
}
