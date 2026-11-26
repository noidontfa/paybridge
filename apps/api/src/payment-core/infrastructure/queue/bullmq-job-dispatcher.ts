import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import {
  JobDispatcher,
  type JobQueue,
  type JobRequest,
} from '../../domain/services/job-dispatcher.js';
import { QUEUES, toJobId } from './queue.constants.js';

/**
 * BullMQ implementation of the `JobDispatcher` port: the only place the
 * application's work reaches BullMQ. The outbox relay and the schedulers use
 * their queues directly, since they are infrastructure themselves.
 */
@Injectable()
export class BullJobDispatcher extends JobDispatcher {
  private readonly queues: Record<JobQueue, Queue>;

  constructor(
    @InjectQueue(QUEUES.webhookInbox) webhookInbox: Queue,
    @InjectQueue(QUEUES.paymentExpiry) paymentExpiry: Queue,
    @InjectQueue(QUEUES.reviewRequery) reviewRequery: Queue,
    @InjectQueue(QUEUES.attemptInitiate) attemptInitiate: Queue,
    @InjectQueue(QUEUES.attemptStatusQuery) attemptStatusQuery: Queue,
  ) {
    super();
    this.queues = {
      webhookInbox,
      paymentExpiry,
      reviewRequery,
      attemptInitiate,
      attemptStatusQuery,
    };
  }

  async enqueue(queue: JobQueue, job: JobRequest): Promise<void> {
    await this.queues[queue].add(job.name, job.data, toBullOptions(job));
  }

  async enqueueMany(
    queue: JobQueue,
    jobs: readonly JobRequest[],
  ): Promise<void> {
    if (jobs.length === 0) return;
    await this.queues[queue].addBulk(
      jobs.map((job) => ({
        name: job.name,
        data: job.data,
        opts: toBullOptions(job),
      })),
    );
  }
}

function toBullOptions(job: JobRequest): JobsOptions {
  return { ...job.options, jobId: toJobId(job.jobId) };
}
