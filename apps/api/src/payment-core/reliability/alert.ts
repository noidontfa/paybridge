import { Injectable, Logger } from '@nestjs/common';

/** Something an operator must look at. */
export interface Alert {
  /** Stable kind, e.g. `webhook-inbox.exhausted`. */
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Where Core raises alerts. The default writes an error log line; deployments
 * bind a pager or chat integration to this token without touching Core.
 */
export abstract class AlertSink {
  abstract raise(alert: Alert): void | Promise<void>;
}

@Injectable()
export class LoggerAlertSink extends AlertSink {
  private readonly logger = new Logger('Alert');

  raise(alert: Alert): void {
    this.logger.error(
      `[${alert.code}] ${alert.message} ${JSON.stringify(alert.details ?? {})}`,
    );
  }
}
