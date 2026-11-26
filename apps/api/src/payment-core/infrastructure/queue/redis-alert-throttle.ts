import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AlertThrottle } from '../../domain/alert.js';
import { QUEUES } from './queue.constants.js';

/**
 * Redis implementation of `AlertThrottle`: a key with a TTL marks an alert as
 * sent. It reuses the webhook inbox queue's connection and key prefix. Only one
 * sweep job runs per minute, so check-then-set is enough.
 */
@Injectable()
export class RedisAlertThrottle extends AlertThrottle {
  constructor(@InjectQueue(QUEUES.webhookInbox) private readonly queue: Queue) {
    super();
  }

  async claim(key: string, windowSeconds: number): Promise<boolean> {
    const prefix = this.queue.opts?.prefix ?? 'bull';
    const client = await this.queue.getBackend().client;
    const redisKey = `${prefix}:alerts:${key}`;
    if ((await client.get(redisKey)) !== null) return false;
    await client.set(redisKey, '1', { EX: windowSeconds });
    return true;
  }
}
