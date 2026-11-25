import { Module } from '@nestjs/common';
import { GetOverview } from '../application/use-cases/console/get-overview.js';
import { Clock, SystemClock } from '../domain/clock.js';
import { OverviewController } from '../http/console/overview.controller.js';
import { OverviewReadRepository } from '../infrastructure/prisma/console-read/overview-read.repository.js';

/** `GET /internal/overview`. Needs the global `PrismaModule`. */
@Module({
  controllers: [OverviewController],
  providers: [
    GetOverview,
    OverviewReadRepository,
    { provide: Clock, useClass: SystemClock },
  ],
})
export class OverviewModule {}
