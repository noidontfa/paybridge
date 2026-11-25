import { Module } from '@nestjs/common';
import { GetReviewSummary } from '../application/use-cases/console/get-review-summary.js';
import { ListReviews } from '../application/use-cases/console/list-reviews.js';
import { ReviewsReadRepository } from '../infrastructure/prisma/console-read/reviews-read.repository.js';
import { ReviewsController } from '../http/console/reviews.controller.js';

/** `GET /internal/reviews` and `/summary`. Needs the global `PrismaModule`. */
@Module({
  controllers: [ReviewsController],
  providers: [ListReviews, GetReviewSummary, ReviewsReadRepository],
})
export class ReviewsModule {}
