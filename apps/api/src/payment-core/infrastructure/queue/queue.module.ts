import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { AlertThrottle } from '../../domain/services/alert.js';
import { JobDispatcher } from '../../domain/services/job-dispatcher.js';
import { BullJobDispatcher } from './bullmq-job-dispatcher.js';
import { QUEUES } from './queue.constants.js';
import { RedisAlertThrottle } from './redis-alert-throttle.js';

/**
 * The BullMQ connection, configured once from `REDIS_URL` and `QUEUE_PREFIX`,
 * and every Core queue registered on it. The application hands work to
 * `JobDispatcher`; only infrastructure injects a queue with
 * `@InjectQueue(QUEUES.x)`. Add a queue by adding it to `QUEUES`.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          url: config.get('REDIS_URL', { infer: true }),
          // Required by BullMQ workers (blocking commands).
          maxRetriesPerRequest: null,
        },
        prefix: config.get('QUEUE_PREFIX', { infer: true }),
      }),
    }),
    BullModule.registerQueue(
      ...Object.values(QUEUES).map((name) => ({ name })),
    ),
  ],
  providers: [
    { provide: JobDispatcher, useClass: BullJobDispatcher },
    { provide: AlertThrottle, useClass: RedisAlertThrottle },
  ],
  exports: [BullModule, JobDispatcher, AlertThrottle],
})
export class QueueModule {}
