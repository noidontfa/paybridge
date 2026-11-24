import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { QUEUES } from './queue.constants.js';

/**
 * The BullMQ connection, configured once from `REDIS_URL` and `QUEUE_PREFIX`,
 * and every Core queue registered on it. Inject a queue with
 * `@InjectQueue(QUEUES.x)`; add a queue by adding it to `QUEUES`.
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
  exports: [BullModule],
})
export class QueueModule {}
