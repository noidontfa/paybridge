import { Inject, Injectable } from '@nestjs/common';
import {
  ReviewsReadRepository,
  type ReviewCounts,
} from '../../../infrastructure/prisma/console-read/reviews-read.repository.js';

/** `GET /internal/reviews/summary`: open, total and open-by-reason counts. */
@Injectable()
export class GetReviewSummary {
  constructor(
    @Inject(ReviewsReadRepository)
    private readonly reviews: ReviewsReadRepository,
  ) {}

  execute(): Promise<ReviewCounts> {
    return this.reviews.counts();
  }
}
