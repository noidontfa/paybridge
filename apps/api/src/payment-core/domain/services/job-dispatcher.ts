/**
 * The background queues Core hands work to. The application names a queue by
 * this key; the infrastructure adapter maps it to the real queue.
 */
export type JobQueue =
  | 'webhookInbox'
  | 'paymentExpiry'
  | 'reviewRequery'
  | 'attemptInitiate'
  | 'attemptStatusQuery';

/** Retry and cleanup settings of one job, in Core's terms. */
export interface JobOptions {
  /** Most tries, the first one included. */
  readonly attempts?: number;
  readonly backoff?: { readonly type: 'exponential'; readonly delay: number };
  /** Wait this long before the first try. */
  readonly delay?: number;
  readonly removeOnComplete?: boolean;
  readonly removeOnFail?: boolean;
}

export interface JobRequest<T = unknown> {
  /** Job name, which the worker uses to tell job kinds apart. */
  readonly name: string;
  /**
   * The id of the row the job was built from. The same row always gets the
   * same id, so a job that is still queued is never added twice.
   */
  readonly jobId: string;
  readonly data: T;
  readonly options?: JobOptions;
}

/**
 * Where Core puts work for background workers. The application depends on
 * this port only; the BullMQ adapter lives in `infrastructure/queue`.
 */
export abstract class JobDispatcher {
  abstract enqueue(queue: JobQueue, job: JobRequest): Promise<void>;
  abstract enqueueMany(
    queue: JobQueue,
    jobs: readonly JobRequest[],
  ): Promise<void>;
}
